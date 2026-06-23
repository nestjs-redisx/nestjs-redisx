/**
 * Integration tests for idempotency error responses against a real Redis
 * instance and a real NestJS HTTP pipeline.
 *
 * Focus: idempotency errors must surface with meaningful HTTP status codes
 * (4xx) rather than 500. The IdempotencyExceptionFilter maps a reused key with
 * a different body to 422 and a previously-failed key to 409.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import request from 'supertest';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { IdempotencyPlugin } from '../../src/idempotency.plugin';
import { Idempotent } from '../../src/idempotency/api/decorators/idempotent.decorator';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

@Controller('orders')
class OrdersController {
  @Post()
  @Idempotent()
  create(@Body() body: Record<string, unknown>): { created: boolean; body: Record<string, unknown> } {
    return { created: true, body };
  }

  @Post('fail')
  @Idempotent()
  createFail(): never {
    throw new Error('downstream failure');
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('IdempotencyPlugin — HTTP error mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await flushRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new IdempotencyPlugin()],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
      controllers: [OrdersController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
    await app.close();
  });

  it('replays the original response for the same key and body', async () => {
    // Given
    const key = 'order-replay';

    // When
    const first = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send({ amount: 100 });
    const second = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send({ amount: 100 });

    // Then
    expect(first.status).toBe(201);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
  });

  it('returns 422 when the same key is reused with a different body', async () => {
    // Given
    const key = 'order-mismatch';
    await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send({ amount: 100 }).expect(201);

    // When - same key, different body
    const res = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send({ amount: 999 });

    // Then - not a 500
    expect(res.status).toBe(422);
    expect(res.body.idempotencyKey).toBe(key);
  });

  it('returns 409 when retrying a key whose previous attempt failed', async () => {
    // Given - first attempt fails inside the handler
    const key = 'order-failed';
    await request(app.getHttpServer()).post('/orders/fail').set('Idempotency-Key', key).send({ amount: 1 }).expect(500);

    // When - retry with the same key
    const res = await request(app.getHttpServer()).post('/orders/fail').set('Idempotency-Key', key).send({ amount: 1 });

    // Then
    expect(res.status).toBe(409);
  });

  it('sets a bounded TTL on the failed record so it does not linger', async () => {
    // Given
    const key = 'order-failed-ttl';
    await request(app.getHttpServer()).post('/orders/fail').set('Idempotency-Key', key).send({ amount: 1 }).expect(500);

    // When - inspect the stored record's TTL (default keyPrefix is 'idempotency:')
    const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
    await client.connect();
    const ttl = await client.ttl(`idempotency:${key}`);
    await client.quit();

    // Then - the failed record expires within the lock window (default 30s)
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });
});
