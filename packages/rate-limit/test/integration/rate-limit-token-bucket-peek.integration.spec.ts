/**
 * Integration tests for token-bucket peek/getState against a real Redis
 * instance.
 *
 * peek()/getState() must report the real remaining tokens (reading the stored
 * bucket) rather than a fabricated full bucket, and must not consume tokens.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { RateLimitPlugin } from '../../src/rate-limit.plugin';
import { RATE_LIMIT_SERVICE } from '../../src/shared/constants';
import type { IRateLimitService } from '../../src/rate-limit/application/ports/rate-limit-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

// Large window so the refill rate is negligible during the test (deterministic).
const CONFIG = { algorithm: 'token-bucket' as const, points: 10, duration: 100000 };

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('RateLimitPlugin — token-bucket peek/getState', () => {
  let module: TestingModule;
  let service: IRateLimitService;

  beforeAll(async () => {
    await flushRedis();

    module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new RateLimitPlugin({ defaultAlgorithm: 'token-bucket' })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();

    await module.init();
    service = module.get<IRateLimitService>(RATE_LIMIT_SERVICE);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
    await module.close();
  });

  it('reports the real remaining tokens after consumption', async () => {
    // Given - consume 3 of 10 tokens
    await service.check('tb-peek', CONFIG);
    await service.check('tb-peek', CONFIG);
    await service.check('tb-peek', CONFIG);

    // When
    const state = await service.getState('tb-peek', CONFIG);

    // Then - 7 tokens remain (not a fabricated full bucket of 10)
    expect(state.limit).toBe(10);
    expect(state.remaining).toBe(7);
    expect(state.current).toBe(3);
  });

  it('does not consume tokens when peeking', async () => {
    // Given
    await service.check('tb-nopeek', CONFIG); // 9 left

    // When - peek several times
    await service.peek('tb-nopeek', CONFIG);
    await service.peek('tb-nopeek', CONFIG);
    const peeked = await service.peek('tb-nopeek', CONFIG);

    // Then - still 9 left; peeking did not consume
    expect(peeked.remaining).toBe(9);
  });

  it('reports a fresh bucket as full', async () => {
    // When - never consumed
    const state = await service.getState('tb-fresh', CONFIG);

    // Then
    expect(state.remaining).toBe(10);
  });
});
