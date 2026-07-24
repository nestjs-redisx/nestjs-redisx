/**
 * Integration tests for crash-recovery takeover and duplicate interceptor
 * binding against a real NestJS HTTP pipeline and a real Redis instance.
 *
 * - Takeover: when the first attempt dies between checkAndLock and complete
 *   (its processing record expires by lock TTL), a concurrent waiter must
 *   atomically take over and execute the request itself — not surface a 500.
 * - Duplicate binding: a globally registered IdempotencyInterceptor combined
 *   with @Idempotent() (which already bundles the interceptor) must engage
 *   idempotency exactly once per request — no self-deadlock, no double lock.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Body, Controller, INestApplication, Post, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import request from 'supertest';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { IdempotencyPlugin } from '../../src/idempotency.plugin';
import { Idempotent } from '../../src/idempotency/api/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../src/idempotency/api/interceptors/idempotency.interceptor';
import { IDEMPOTENCY_SERVICE } from '../../src/shared/constants';
import type { IIdempotencyService } from '../../src/idempotency/application/ports/idempotency-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const executions: string[] = [];

@Controller('orders')
class OrdersController {
  @Post()
  // Deliberate DOUBLE binding: @Idempotent already bundles the interceptor.
  // Before the per-request marker this self-deadlocked for lockTimeout ms
  // and then returned 500.
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  create(@Body() body: Record<string, unknown>): { ok: true; body: Record<string, unknown> } {
    executions.push(String(body.id ?? ''));
    return { ok: true, body };
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('Idempotency — takeover & duplicate binding (live Redis)', () => {
  let app: INestApplication;
  let service: IIdempotencyService;

  beforeAll(async () => {
    await flushRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          // Short lock so the takeover test does not wait 30s.
          plugins: [new IdempotencyPlugin({ lockTimeout: 500, waitTimeout: 5000 })],
        }),
      ],
      controllers: [OrdersController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get<IIdempotencyService>(IDEMPOTENCY_SERVICE);
  });

  beforeEach(async () => {
    executions.length = 0;
    await flushRedis();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await flushRedis();
    await app.close();
  });

  it('a doubly-bound interceptor does NOT self-deadlock: fast 2xx, handler runs once', async () => {
    // Given / When — the reporter's exact scenario
    const started = Date.now();
    const res = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'dup-key-1').send({ id: 'a1' });
    const elapsed = Date.now() - started;

    // Then — no 30s hang, no 500; the handler executed exactly once
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, body: { id: 'a1' } });
    expect(elapsed).toBeLessThan(2000);
    expect(executions).toEqual(['a1']);

    // And a replay still works
    const replay = await request(app.getHttpServer()).post('/orders').set('Idempotency-Key', 'dup-key-1').send({ id: 'a1' });
    expect(replay.status).toBe(201);
    expect(executions).toEqual(['a1']); // not executed again
  });

  it('a waiter takes over when the first attempt dies before completing', async () => {
    // Given — a "crashed" first attempt: lock acquired, never completed
    const first = await service.checkAndLock('crash-key', 'fp-x');
    expect(first.isNew).toBe(true);
    // (no complete() — simulates the process dying; record TTL = 500ms)

    // When — a concurrent second attempt arrives and waits
    const second = await service.checkAndLock('crash-key', 'fp-x');

    // Then — after the record expires, the waiter atomically took over
    expect(second).toEqual({ isNew: true });
  });

  it('after a takeover the new owner completes and later requests replay its response', async () => {
    // Given — dead first attempt, waiter takes over
    await service.checkAndLock('crash-key-2', 'fp-y');
    const takeover = await service.checkAndLock('crash-key-2', 'fp-y');
    expect(takeover.isNew).toBe(true);

    // When — the new owner completes
    await service.complete('crash-key-2', { statusCode: 201, body: { done: true } }, { fingerprint: 'fp-y' });

    // Then — a third request replays the completed record
    const third = await service.checkAndLock('crash-key-2', 'fp-y');
    expect(third.isNew).toBe(false);
    expect(third.record?.status).toBe('completed');
    expect(JSON.parse(third.record!.response!)).toEqual({ done: true });
  });

  it('replay keeps matching after a record was re-created past its lock TTL (fingerprint persisted)', async () => {
    // Given — a slow handler: lock expires BEFORE complete() runs
    await service.checkAndLock('slow-key', 'fp-slow');
    await new Promise((resolve) => setTimeout(resolve, 700)); // record expired (500ms TTL)

    // When — complete() re-creates the record (now WITH the fingerprint)
    await service.complete('slow-key', { statusCode: 200, body: 'late' }, { fingerprint: 'fp-slow' });

    // Then — the same request replays instead of being misread as a 422 mismatch
    const replay = await service.checkAndLock('slow-key', 'fp-slow');
    expect(replay.isNew).toBe(false);
    expect(replay.fingerprintMismatch).toBeUndefined();
    expect(replay.record?.status).toBe('completed');
  });

  it('validateFingerprint:false replays a reused key even when the request differs', async () => {
    // Given — a completed record for key with fingerprint A
    const first = await service.checkAndLock('lenient-key', 'fp-A', { validateFingerprint: false });
    expect(first.isNew).toBe(true);
    await service.complete('lenient-key', { statusCode: 200, body: 'original' }, { fingerprint: 'fp-A' });

    // When — the same key arrives with a DIFFERENT fingerprint but validation disabled
    const second = await service.checkAndLock('lenient-key', 'fp-B', { validateFingerprint: false });

    // Then — replay instead of a 422 mismatch
    expect(second.isNew).toBe(false);
    expect(second.fingerprintMismatch).toBeUndefined();
    expect(JSON.parse(second.record!.response!)).toBe('original');

    // And with validation ON (default) the same mismatch is still rejected
    const strict = await service.checkAndLock('lenient-key', 'fp-B');
    expect(strict.fingerprintMismatch).toBe(true);
  });
});
