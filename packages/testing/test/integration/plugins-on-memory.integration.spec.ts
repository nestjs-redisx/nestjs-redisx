import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin, LOCK_SERVICE, type ILockService, LockAcquisitionError } from '@nestjs-redisx/locks';
import { CachePlugin, CACHE_SERVICE, type ICacheService } from '@nestjs-redisx/cache';
import { RateLimitPlugin, RATE_LIMIT_SERVICE, type IRateLimitService } from '@nestjs-redisx/rate-limit';
import { IdempotencyPlugin, IDEMPOTENCY_SERVICE, type IIdempotencyService } from '@nestjs-redisx/idempotency';
import { StreamsPlugin, STREAM_PRODUCER, STREAM_CONSUMER, type IStreamProducer, type IStreamConsumer, type ConsumerHandle } from '@nestjs-redisx/streams';

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
    it('locks a new key, replays the completed record, and detects fingerprint mismatch (Lua check-and-lock)', async () => {
      // Given
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
      const idem = app.get<IIdempotencyService>(IDEMPOTENCY_SERVICE);

      // When — first request with a fingerprint is new and acquires the lock
      const first = await idem.checkAndLock('pay:1', 'fp-a');
      expect(first.isNew).toBe(true);

      // And the handler completes, storing the response
      await idem.complete('pay:1', { statusCode: 200, body: { ok: true } });

      // Then — a replay with the same fingerprint returns the stored record
      const replay = await idem.checkAndLock('pay:1', 'fp-a');
      expect(replay.isNew).toBe(false);
      expect(replay.record?.status).toBe('completed');
      expect(replay.record?.statusCode).toBe(200);

      // And a different fingerprint on the same key is a mismatch
      const mismatch = await idem.checkAndLock('pay:1', 'fp-b');
      expect(mismatch.isNew).toBe(false);
      expect(mismatch.fingerprintMismatch).toBe(true);
    });
  });

  describe('StreamsPlugin', () => {
    it('round-trips messages producer → consumer group → ack (no Redis)', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new StreamsPlugin()],
          }),
        ],
      }).compile();
      await app.init();
      const producer = app.get<IStreamProducer>(STREAM_PRODUCER);
      const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);

      // When — a consumer group subscribes and the producer publishes two messages
      const received: Array<{ n: number }> = [];
      let resolveDone: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const handle: ConsumerHandle = consumer.consume<{ n: number }>('orders', 'g1', 'c1', async (msg) => {
        received.push(msg.data);
        if (received.length >= 2) resolveDone();
      });

      await producer.publish('orders', { n: 1 });
      await producer.publish('orders', { n: 2 });

      // Then — both are delivered and processed
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for stream messages')), 4000))]);
      await consumer.stop(handle);

      expect(received).toEqual([{ n: 1 }, { n: 2 }]);

      // And after ACK there are no pending entries left
      const pending = await consumer.getPending('orders', 'g1');
      expect(pending.count).toBe(0);
    });

    it('exposes stream info via the producer service', async () => {
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new StreamsPlugin()],
          }),
        ],
      }).compile();
      await app.init();
      const producer = app.get<IStreamProducer>(STREAM_PRODUCER);

      await producer.publish('events', { a: 1 });
      await producer.publish('events', { a: 2 });

      const info = await producer.getStreamInfo('events');
      expect(info.length).toBe(2);
    });
  });

  it('does not leak: LockAcquisitionError type is the real one', () => {
    expect(LockAcquisitionError).toBeTypeOf('function');
  });
});
