import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule, CLIENT_MANAGER, type RedisClientManager } from '@nestjs-redisx/core';
import { LocksPlugin, LOCK_SERVICE, type ILockService, LockAcquisitionError } from '@nestjs-redisx/locks';
import { CachePlugin, CACHE_SERVICE, type ICacheService } from '@nestjs-redisx/cache';
import { RateLimitPlugin, RATE_LIMIT_SERVICE, type IRateLimitService } from '@nestjs-redisx/rate-limit';
import { IdempotencyPlugin, IDEMPOTENCY_SERVICE, type IIdempotencyService } from '@nestjs-redisx/idempotency';
import { CircuitBreakerPlugin, CIRCUIT_BREAKER_SERVICE, CircuitBreakerOpenError, type ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { PubSubPlugin, PUBSUB_SERVICE, type IPubSubService, type IPubSubMessage } from '@nestjs-redisx/pubsub';
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

    it('complete() re-creating an expired record still sets a TTL (atomic write — no immortal keys)', async () => {
      // Given — a very short lock so the processing record expires mid-handler
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new IdempotencyPlugin({ lockTimeout: 100 })],
          }),
        ],
      }).compile();
      await app.init();
      const idem = app.get<IIdempotencyService>(IDEMPOTENCY_SERVICE);
      const manager = app.get<RedisClientManager>(CLIENT_MANAGER);
      const driver = await manager.getClient();

      const first = await idem.checkAndLock('pay:slow', 'fp-slow');
      expect(first.isNew).toBe(true);

      // When — the "handler" outlives the retention window (2x lockTimeout),
      // so complete() re-creates the key from scratch
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await driver.pttl('idempotency:pay:slow')).toBe(-2); // record is gone
      await idem.complete('pay:slow', { statusCode: 200, body: { ok: true } }, { fingerprint: 'fp-slow' });

      // Then — the re-created record carries a real TTL (previously HMSET and
      // EXPIRE were two commands; a crash between them left the key immortal)
      const pttl = await driver.pttl('idempotency:pay:slow');
      expect(pttl).toBeGreaterThan(0);

      // And it replays normally
      const replay = await idem.checkAndLock('pay:slow', 'fp-slow');
      expect(replay.isNew).toBe(false);
      expect(replay.record?.status).toBe('completed');
    });

    it('retains a stale processing record past lockTimeout and takes it over ATOMICALLY', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new IdempotencyPlugin({ lockTimeout: 100 })],
          }),
        ],
      }).compile();
      await app.init();
      const idem = app.get<IIdempotencyService>(IDEMPOTENCY_SERVICE);
      const manager = app.get<RedisClientManager>(CLIENT_MANAGER);
      const driver = await manager.getClient();

      const first = await idem.checkAndLock('pay:crash', 'fp-crash');
      expect(first.isNew).toBe(true);

      // Then — the record is retained for ~2x lockTimeout, NOT just the lock
      // window: that retention is what makes the takeover atomic in Lua
      expect(await driver.pttl('idempotency:pay:crash')).toBeGreaterThan(100);

      // When — the lock goes stale (holder presumed dead) but the record still exists
      await new Promise((resolve) => setTimeout(resolve, 130));
      const stillThere = await idem.get('pay:crash');
      expect(stillThere?.status).toBe('processing');

      // Then — the next contender takes over atomically inside the script
      const takeover = await idem.checkAndLock('pay:crash', 'fp-crash');
      expect(takeover.isNew).toBe(true);
    });
  });

  describe('CachePlugin stale-if-error', () => {
    it('serves the last known value when the loader fails, until the SIE window closes', async () => {
      // Given — 1s TTL, no SWR, 3s stale-if-error window
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new CachePlugin({ l1: { enabled: false }, staleIfError: { enabled: true, defaultWindow: 3 } })],
          }),
        ],
      }).compile();
      await app.init();
      const cache = app.get<ICacheService>(CACHE_SERVICE);

      // Populate through the real pipeline
      const first = await cache.getOrSet('sie:report', async () => 'v1', { ttl: 1 });
      expect(first).toBe('v1');

      // When — past the TTL the entry is a miss on the success path...
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const failing = vi.fn().mockRejectedValue(new Error('upstream down'));
      const served = await cache.getOrSet('sie:report', failing, { ttl: 1 });

      // Then — ...but the retained value is served when the loader FAILS
      expect(served).toBe('v1');
      expect(failing).toHaveBeenCalledTimes(1);

      // And a healthy loader takes back over immediately (expired = normal miss)
      const recovered = await cache.getOrSet('sie:report', async () => 'v2', { ttl: 1 });
      expect(recovered).toBe('v2');
    });

    it('rethrows once the retained value is gone (window passed, key expired from Redis)', async () => {
      // Given — 1s TTL + 1s window: full retention is ~2s
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new CachePlugin({ l1: { enabled: false }, staleIfError: { enabled: true, defaultWindow: 1 } })],
          }),
        ],
      }).compile();
      await app.init();
      const cache = app.get<ICacheService>(CACHE_SERVICE);

      await cache.getOrSet('sie:gone', async () => 'v1', { ttl: 1 });

      // When — beyond TTL + window nothing is retained
      await new Promise((resolve) => setTimeout(resolve, 2200));

      // Then — the loader error propagates (nothing safe to serve)
      await expect(cache.getOrSet('sie:gone', vi.fn().mockRejectedValue(new Error('still down')), { ttl: 1 })).rejects.toThrow('still down');
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

  describe('CircuitBreakerPlugin', () => {
    it('runs a full closed -> open -> half-open -> closed cycle over Lua', async () => {
      // Given — trips after 2 failures; short cooldown for the probe phase
      const OPEN_MS = 120;
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new CircuitBreakerPlugin({ failureThreshold: 2, windowMs: 10000, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1 })],
          }),
        ],
      }).compile();
      await app.init();
      const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);

      // When — two failures trip the breaker
      await expect(cb.execute('dep', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
      await expect(cb.execute('dep', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

      // Then — OPEN: rejected fast, fn is not executed
      expect((await cb.getState('dep')).state).toBe('open');
      let executed = false;
      await expect(
        cb.execute('dep', () => {
          executed = true;
          return Promise.resolve('no');
        }),
      ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
      expect(executed).toBe(false);

      // When — the cooldown elapses and a probe succeeds
      await new Promise((resolve) => setTimeout(resolve, OPEN_MS + 40));
      await expect(cb.execute('dep', () => Promise.resolve('ok'))).resolves.toBe('ok');

      // Then — CLOSED again
      expect((await cb.getState('dep')).state).toBe('closed');
    });

    it('supports fallback while OPEN and reset back to CLOSED', async () => {
      // Given — a tripped breaker
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new CircuitBreakerPlugin({ failureThreshold: 1, windowMs: 10000, openDurationMs: 60000, halfOpenMaxCalls: 1, successThreshold: 1 })],
          }),
        ],
      }).compile();
      await app.init();
      const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
      await expect(cb.execute('dep', () => Promise.reject(new Error('down')))).rejects.toThrow();
      expect((await cb.getState('dep')).state).toBe('open');

      // When / Then — fallback is served instead of the error
      await expect(cb.execute('dep', () => Promise.resolve('real'), { fallback: () => 'cached' })).resolves.toBe('cached');

      // When / Then — reset returns the circuit to CLOSED
      await cb.reset('dep');
      expect((await cb.getState('dep')).state).toBe('closed');
      await expect(cb.execute('dep', () => Promise.resolve('real'))).resolves.toBe('real');
    });
  });

  describe('PubSubPlugin', () => {
    it('round-trips a typed message through the dedicated subscriber connection', async () => {
      // Given
      app = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: { type: 'single', host: 'x', port: 1 },
            global: { driver: MEMORY_DRIVER_TYPE },
            plugins: [new PubSubPlugin()],
          }),
        ],
      }).compile();
      await app.init();
      const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);

      const got: IPubSubMessage[] = [];
      await pubsub.subscribe<{ n: number }>('events.tick', (msg) => {
        got.push(msg);
      });

      // When
      const receivers = await pubsub.publish('events.tick', { n: 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Then — the in-memory bus spans the publisher and subscriber clients
      expect(receivers).toBeGreaterThanOrEqual(1);
      expect(got[0]).toMatchObject({ channel: 'events.tick', data: { n: 1 } });
    });
  });

  it('does not leak: LockAcquisitionError type is the real one', () => {
    expect(LockAcquisitionError).toBeTypeOf('function');
  });
});
