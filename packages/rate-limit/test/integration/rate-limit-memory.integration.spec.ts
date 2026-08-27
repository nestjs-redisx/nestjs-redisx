/**
 * End-to-end validation on the in-memory driver — NO Redis required.
 *
 * Covers the two-store feature through production code:
 * - plugin default `store: 'memory'` limits routes via the in-process store;
 * - per-route `@RateLimit({ store: 'redis' })` overrides back to the
 *   driver-backed store (all three Lua scripts on the memory interpreter,
 *   including the hash-based fixed-window script);
 * - reset() default sweeps BOTH stores; `{ store }` targets one;
 * - reset() actually clears a fixed-window counter (regression: the old
 *   per-window subkey layout made reset a no-op for fixed-window).
 */

import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { RateLimitPlugin } from '../../src/rate-limit.plugin';
import { RateLimit } from '../../src/rate-limit/api/decorators/rate-limit.decorator';
import { RATE_LIMIT_SERVICE } from '../../src/shared/constants';
import type { IRateLimitService } from '../../src/rate-limit/application/ports/rate-limit-service.port';

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

/** Overrides the plugin default back to the driver-backed redis store. */
@Controller('strict')
class StrictController {
  @Get()
  @RateLimit({ key: 'strict-route', store: 'redis', points: REDIS_LIMIT, duration: 60, algorithm: 'fixed-window' })
  get(): { ok: boolean } {
    return { ok: true };
  }
}

describe('RateLimitPlugin stores on the in-memory driver (no Redis)', () => {
  let app: INestApplication;
  let service: IRateLimitService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'unused', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new RateLimitPlugin({ store: 'memory', defaultAlgorithm: 'sliding-window' })],
        }),
      ],
      controllers: [MemController, StrictController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get<IRateLimitService>(RATE_LIMIT_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('HTTP routes with mixed stores', () => {
    it('limits a route through the memory store when it is the plugin default', async () => {
      // When — exhaust the memory-backed limit
      for (let i = 0; i < MEM_LIMIT; i++) {
        const res = await request(app.getHttpServer()).get('/mem').expect(200);
        expect(res.headers['x-ratelimit-limit']).toBe(String(MEM_LIMIT));
        expect(res.headers['x-ratelimit-remaining']).toBe(String(MEM_LIMIT - 1 - i));
      }

      // Then
      await request(app.getHttpServer()).get('/mem').expect(429);
    });

    it('limits a store:redis route through the driver-backed store', async () => {
      // When — exhaust the redis-backed limit (fixed-window Lua on the driver)
      for (let i = 0; i < REDIS_LIMIT; i++) {
        await request(app.getHttpServer()).get('/strict').expect(200);
      }

      // Then
      await request(app.getHttpServer()).get('/strict').expect(429);

      // And the counter is visible in the redis store only
      const inRedis = await service.peek('strict-route', { store: 'redis', algorithm: 'fixed-window', points: REDIS_LIMIT, duration: 60 });
      const inMemory = await service.peek('strict-route', { store: 'memory', algorithm: 'fixed-window', points: REDIS_LIMIT, duration: 60 });
      expect(inRedis.current).toBeGreaterThanOrEqual(REDIS_LIMIT);
      expect(inMemory.current).toBe(0);
    });
  });

  describe('service-level parity across stores', () => {
    it('produces the same results for the same scenario on both stores (all algorithms)', async () => {
      for (const algorithm of ['fixed-window', 'sliding-window', 'token-bucket'] as const) {
        // Given
        const key = `parity:${algorithm}`;
        const config = { algorithm, points: 5, duration: 60 };

        // When — consume twice on each store
        const redisResults = [await service.check(key, { ...config, store: 'redis' }), await service.check(key, { ...config, store: 'redis' })];
        const memoryResults = [await service.check(key, { ...config, store: 'memory' }), await service.check(key, { ...config, store: 'memory' })];

        // Then — identical semantics
        for (let i = 0; i < 2; i++) {
          expect(memoryResults[i]!.allowed).toBe(redisResults[i]!.allowed);
          expect(memoryResults[i]!.limit).toBe(redisResults[i]!.limit);
          expect(memoryResults[i]!.remaining).toBe(redisResults[i]!.remaining);
          expect(memoryResults[i]!.current).toBe(redisResults[i]!.current);
        }
      }
    });

    it('keeps counters for the same logical key fully independent between stores', async () => {
      // Given
      const key = 'independent';
      const config = { algorithm: 'sliding-window', points: 5, duration: 60 } as const;

      // When — 3 hits on redis, 1 on memory
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'memory' });

      // Then
      const redisState = await service.peek(key, { ...config, store: 'redis' });
      const memoryState = await service.peek(key, { ...config, store: 'memory' });
      expect(redisState.current).toBe(3);
      expect(memoryState.current).toBe(1);
    });
  });

  describe('reset', () => {
    it('clears a fixed-window counter in the redis store (regression: subkey layout made this a no-op)', async () => {
      // Given
      const key = 'reset:fixed';
      const config = { algorithm: 'fixed-window', points: 5, duration: 60 } as const;
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'redis' });
      expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(2);

      // When
      await service.reset(key);

      // Then
      expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(0);
    });

    it('sweeps BOTH stores by default', async () => {
      // Given
      const key = 'reset:both';
      const config = { algorithm: 'sliding-window', points: 5, duration: 60 } as const;
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'memory' });

      // When
      await service.reset(key);

      // Then
      expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(0);
      expect((await service.peek(key, { ...config, store: 'memory' })).current).toBe(0);
    });

    it('targets a single store when requested', async () => {
      // Given
      const key = 'reset:targeted';
      const config = { algorithm: 'sliding-window', points: 5, duration: 60 } as const;
      await service.check(key, { ...config, store: 'redis' });
      await service.check(key, { ...config, store: 'memory' });

      // When — clear only the redis store
      await service.reset(key, { store: 'redis' });

      // Then — the memory counter survives
      expect((await service.peek(key, { ...config, store: 'redis' })).current).toBe(0);
      expect((await service.peek(key, { ...config, store: 'memory' })).current).toBe(1);
    });
  });
});
