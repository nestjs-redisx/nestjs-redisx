/**
 * Integration tests for the two-store feature against a REAL Redis instance:
 * - plugin default `store: 'memory'` with a per-route `store: 'redis'`
 *   override through a real NestJS HTTP pipeline;
 * - result parity between the redis and memory stores for all algorithms;
 * - reset() sweeping both stores / targeting one;
 * - reset() clearing a fixed-window counter (regression: the old per-window
 *   subkey layout made reset a no-op for fixed-window).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import request from 'supertest';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { RateLimitPlugin } from '../../src/rate-limit.plugin';
import { RateLimit } from '../../src/rate-limit/api/decorators/rate-limit.decorator';
import { RATE_LIMIT_SERVICE } from '../../src/shared/constants';
import type { IRateLimitService } from '../../src/rate-limit/application/ports/rate-limit-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const MEM_LIMIT = 3;
const REDIS_LIMIT = 2;

/** Uses the plugin default store ('memory' in this app). */
@Controller('mem')
class MemController {
  @Get()
  @RateLimit({ key: 'mem-route', points: MEM_LIMIT, duration: 60 })
  get(): { ok: boolean } {
    return { ok: true };
  }
}

/** Auth-style route pinned to the exact, distributed store. */
@Controller('strict')
class StrictController {
  @Get()
  @RateLimit({ key: 'strict-route', store: 'redis', points: REDIS_LIMIT, duration: 60, algorithm: 'fixed-window' })
  get(): { ok: boolean } {
    return { ok: true };
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('RateLimitPlugin — memory/redis stores (live Redis)', () => {
  let app: INestApplication;
  let service: IRateLimitService;

  beforeAll(async () => {
    await flushRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new RateLimitPlugin({ store: 'memory', defaultAlgorithm: 'sliding-window' })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
      controllers: [MemController, StrictController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get<IRateLimitService>(RATE_LIMIT_SERVICE);
  });

  beforeEach(async () => {
    await flushRedis();
    // Memory-store counters do not live in Redis; clear them through the API.
    await service.reset('mem-route');
    for (const algorithm of ['fixed-window', 'sliding-window', 'token-bucket']) {
      await service.reset(`parity:${algorithm}`);
    }
    await service.reset('independent');
    await service.reset('reset:fixed');
  });

  afterAll(async () => {
    await flushRedis();
    await app.close();
  });

  it('limits the memory-store route per instance without touching Redis keys', async () => {
    // When — exhaust the memory-backed limit
    for (let i = 0; i < MEM_LIMIT; i++) {
      const res = await request(app.getHttpServer()).get('/mem').expect(200);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(MEM_LIMIT - 1 - i));
    }
    await request(app.getHttpServer()).get('/mem').expect(429);

    // Then — no rate-limit keys were written to Redis for this route
    const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
    await client.connect();
    const keys = await client.keys('rl:*mem-route*');
    await client.quit();
    expect(keys).toEqual([]);
  });

  it('keeps the store:redis route exact and distributed (keys live in Redis)', async () => {
    // When
    for (let i = 0; i < REDIS_LIMIT; i++) {
      await request(app.getHttpServer()).get('/strict').expect(200);
    }
    await request(app.getHttpServer()).get('/strict').expect(429);

    // Then — the counter is a real Redis key
    const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
    await client.connect();
    const keys = await client.keys('rl:fixed-window:strict-route*');
    await client.quit();
    expect(keys.length).toBeGreaterThan(0);
  });

  it('produces the same results for the same scenario on both stores (all algorithms)', async () => {
    for (const algorithm of ['fixed-window', 'sliding-window', 'token-bucket'] as const) {
      // Given
      const key = `parity:${algorithm}`;
      const config = { algorithm, points: 5, duration: 60 };

      // When
      const redisResults = [await service.check(key, { ...config, store: 'redis' }), await service.check(key, { ...config, store: 'redis' })];
      const memoryResults = [await service.check(key, { ...config, store: 'memory' }), await service.check(key, { ...config, store: 'memory' })];

      // Then
      for (let i = 0; i < 2; i++) {
        expect(memoryResults[i]!.allowed).toBe(redisResults[i]!.allowed);
        expect(memoryResults[i]!.limit).toBe(redisResults[i]!.limit);
        expect(memoryResults[i]!.remaining).toBe(redisResults[i]!.remaining);
        expect(memoryResults[i]!.current).toBe(redisResults[i]!.current);
      }
    }
  });

  it('clears a fixed-window counter on reset (regression test)', async () => {
    // Given
    const key = 'reset:fixed';
    const config = { algorithm: 'fixed-window', points: 5, duration: 60 } as const;
    await service.check(key, { ...config, store: 'redis' });
    await service.check(key, { ...config, store: 'redis' });
    expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(2);

    // When
    await service.reset(key);

    // Then — counting starts from scratch
    expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(0);
    const after = await service.check(key, { ...config, store: 'redis' });
    expect(after.current).toBe(1);
  });

  it('sweeps both stores by default and targets one when asked', async () => {
    // Given
    const key = 'independent';
    const config = { algorithm: 'sliding-window', points: 5, duration: 60 } as const;
    await service.check(key, { ...config, store: 'redis' });
    await service.check(key, { ...config, store: 'memory' });

    // When — targeted reset leaves the other store intact
    await service.reset(key, { store: 'redis' });
    expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(0);
    expect((await service.peek(key, { ...config, store: 'memory' })).current).toBe(1);

    // And — the default reset sweeps what remains
    await service.reset(key);
    expect((await service.peek(key, { ...config, store: 'memory' })).current).toBe(0);
  });
});
