import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin, LOCK_SERVICE, type ILockService, LockAcquisitionError } from '@nestjs-redisx/locks';
import { CachePlugin, CACHE_SERVICE, type ICacheService } from '@nestjs-redisx/cache';
import { RateLimitPlugin, RATE_LIMIT_SERVICE, type IRateLimitService } from '@nestjs-redisx/rate-limit';
import { IdempotencyPlugin, IDEMPOTENCY_SERVICE, type IIdempotencyService } from '@nestjs-redisx/idempotency';

import { RedisTestingModule } from '../../src';
import { MEMORY_DRIVER_TYPE } from '../../src';

/**
 * End-to-end validation: the real plugins (cache, locks, rate-limit, idempotency)
 * run against the in-memory driver with NO Redis. This exercises the full stack —
 * store + command executor + Lua interpreter + adapter — through production code.
 */
describe('Plugins on the in-memory driver (no Redis)', () => {
  let app: TestingModule | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('RedisTestingModule wrapper', () => {
    it('boots RedisModule with the memory driver', async () => {
      // Given / When
      app = await Test.createTestingModule({
        imports: [RedisTestingModule.forRoot({ plugins: [new CachePlugin()] })],
      }).compile();
      await app.init();

      // Then
      expect(app.get<ICacheService>(CACHE_SERVICE)).toBeDefined();
    });

    it('forces the memory driver via forRootAsync', async () => {
      // Given / When
      app = await Test.createTestingModule({
        imports: [
          RedisTestingModule.forRootAsync({
            plugins: [new CachePlugin()],
            useFactory: () => ({}),
          }),
        ],
      }).compile();
      await app.init();

      // Then
      expect(app.get<ICacheService>(CACHE_SERVICE)).toBeDefined();
    });
  });

  describe('LocksPlugin', () => {
    it('acquires, holds, and releases a distributed lock (Lua release path)', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [RedisModule.forRoot({ clients: { type: 'single', host: 'x', port: 1 }, global: { driver: MEMORY_DRIVER_TYPE }, plugins: [new LocksPlugin()] })],
      }).compile();
      await app.init();
      const locks = app.get<ILockService>(LOCK_SERVICE);

      // When
      const lock = await locks.acquire('order:1', { ttl: 5000 });

      // Then — a second non-retrying attempt must fail while held
      await expect(locks.tryAcquire('order:1', { ttl: 5000 })).resolves.toBeNull();

      // When released, the key is free again
      await lock.release();
      const second = await locks.tryAcquire('order:1', { ttl: 5000 });
      expect(second).not.toBeNull();
      await second?.release();
    });

    it('runs a critical section via withLock', async () => {
      app = await Test.createTestingModule({
        imports: [RedisModule.forRoot({ clients: { type: 'single', host: 'x', port: 1 }, global: { driver: MEMORY_DRIVER_TYPE }, plugins: [new LocksPlugin()] })],
      }).compile();
      await app.init();
      const locks = app.get<ILockService>(LOCK_SERVICE);

      const result = await locks.withLock('job:nightly', async () => 'done', { ttl: 5000 });
      expect(result).toBe('done');
    });
  });

  describe('CachePlugin', () => {
    it('getOrSet loads once and serves from cache', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [RedisModule.forRoot({ clients: { type: 'single', host: 'x', port: 1 }, global: { driver: MEMORY_DRIVER_TYPE }, plugins: [new CachePlugin()] })],
      }).compile();
      await app.init();
      const cache = app.get<ICacheService>(CACHE_SERVICE);

      let calls = 0;
      const loader = async () => {
        calls += 1;
        return { id: 1, name: 'Ada' };
      };

      // When
      const first = await cache.getOrSet('user:1', loader, { ttl: 60 });
      const second = await cache.getOrSet('user:1', loader, { ttl: 60 });

      // Then
      expect(first).toEqual({ id: 1, name: 'Ada' });
      expect(second).toEqual({ id: 1, name: 'Ada' });
      expect(calls).toBe(1);
    });

    it('set/get/del round-trip', async () => {
      app = await Test.createTestingModule({
        imports: [RedisModule.forRoot({ clients: { type: 'single', host: 'x', port: 1 }, global: { driver: MEMORY_DRIVER_TYPE }, plugins: [new CachePlugin()] })],
      }).compile();
      await app.init();
      const cache = app.get<ICacheService>(CACHE_SERVICE);

      await cache.set('k', 'v', { ttl: 60 });
      expect(await cache.get('k')).toBe('v');
      await cache.delete('k');
      expect(await cache.get('k')).toBeNull();
    });
  });

  describe('RateLimitPlugin', () => {
    it('consumes points and blocks once the limit is exhausted', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new RateLimitPlugin({ defaultAlgorithm: 'token-bucket', defaultPoints: 2, defaultDuration: 60 })],
          }),
        ],
      }).compile();
      await app.init();
      const rl = app.get<IRateLimitService>(RATE_LIMIT_SERVICE);

      // When / Then
      expect((await rl.check('ip:1')).allowed).toBe(true);
      expect((await rl.check('ip:1')).allowed).toBe(true);
      const third = await rl.check('ip:1');
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
    });

    it('peek does not consume', async () => {
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new RateLimitPlugin({ defaultAlgorithm: 'token-bucket', defaultPoints: 5, defaultDuration: 60 })],
          }),
        ],
      }).compile();
      await app.init();
      const rl = app.get<IRateLimitService>(RATE_LIMIT_SERVICE);

      await rl.check('ip:2');
      const before = await rl.peek('ip:2');
      const after = await rl.peek('ip:2');
      expect(before.remaining).toBe(after.remaining);
    });
  });

  describe('IdempotencyPlugin', () => {
    it('is registered and exposes the service', async () => {
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new IdempotencyPlugin()],
          }),
        ],
      }).compile();
      await app.init();

      expect(app.get<IIdempotencyService>(IDEMPOTENCY_SERVICE)).toBeDefined();
    });
  });

  it('does not leak: LockAcquisitionError type is the real one', () => {
    expect(LockAcquisitionError).toBeTypeOf('function');
  });
});
