/**
 * Integration tests for the idempotency `errorPolicy` option against a real
 * NestJS HTTP pipeline.
 *
 * The store is bootstrapped against a real Redis instance, but its gating call
 * (`checkAndLock`) is forced to fail to simulate the store being unavailable.
 * With `fail-open` the request proceeds without idempotency protection; with
 * `fail-closed` (default) the request is rejected.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import request from 'supertest';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { IdempotencyPlugin } from '../../src/idempotency.plugin';
import { Idempotent } from '../../src/idempotency/api/decorators/idempotent.decorator';
import { IDEMPOTENCY_STORE } from '../../src/shared/constants';
import type { IIdempotencyStore } from '../../src/idempotency/application/ports/idempotency-store.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

@Controller('payments')
class PaymentsController {
  @Post()
  @Idempotent()
  create(@Body() body: Record<string, unknown>): { ok: boolean; body: Record<string, unknown> } {
    return { ok: true, body };
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

async function createApp(errorPolicy: 'fail-open' | 'fail-closed'): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [new IdempotencyPlugin({ errorPolicy })],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
      }),
    ],
    controllers: [PaymentsController],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  // Simulate the store being unavailable on the gating call.
  const store = app.get<IIdempotencyStore>(IDEMPOTENCY_STORE);
  vi.spyOn(store, 'checkAndLock').mockRejectedValue(new Error('Redis connection refused'));

  return app;
}

describeIntegration('IdempotencyPlugin — errorPolicy when the store is unavailable', () => {
  let failOpenApp: INestApplication;
  let failClosedApp: INestApplication;

  beforeAll(async () => {
    await flushRedis();
    failOpenApp = await createApp('fail-open');
    failClosedApp = await createApp('fail-closed');
  });

  afterAll(async () => {
    await flushRedis();
    await failOpenApp.close();
    await failClosedApp.close();
  });

  it('proceeds and serves the request with fail-open', async () => {
    // When
    const res = await request(failOpenApp.getHttpServer()).post('/payments').set('Idempotency-Key', 'fo-1').send({ amount: 100 });

    // Then - handler still ran
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, body: { amount: 100 } });
  });

  it('rejects the request with fail-closed (default)', async () => {
    // When
    const res = await request(failClosedApp.getHttpServer()).post('/payments').set('Idempotency-Key', 'fc-1').send({ amount: 100 });

    // Then - the store error propagates as a server error
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
