import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';

import { RedisSessionStoreAdapter } from '../../src/session/infrastructure/adapters/redis-session-store.adapter';
import { SessionLimitExceededError, SessionSerializationError, SessionStoreError } from '../../src/shared/errors';
import { defaultUserIdExtractor } from '../../src/session/domain/session-metadata';
import type { ISessionPluginOptions } from '../../src/shared/types';
import { createMockDriver, routeEvalsha } from '../mocks';

const NOW = 1_700_000_000_000;

interface IMetricsMock {
  incrementCounter: ReturnType<typeof vi.fn>;
}

function baseOptions(overrides: Partial<ISessionPluginOptions> = {}): ISessionPluginOptions {
  return {
    keyPrefix: 'sess:',
    defaultTtlMs: 60_000,
    maxSessionsPolicy: 'evict-oldest',
    userIdExtractor: defaultUserIdExtractor,
    ...overrides,
  };
}

async function initAdapter(driver: MockedObject<IRedisDriver>, options: ISessionPluginOptions, metrics?: IMetricsMock): Promise<RedisSessionStoreAdapter> {
  const adapter = new RedisSessionStoreAdapter(driver, options, metrics as never);
  await adapter.onModuleInit();
  return adapter;
}

describe('RedisSessionStoreAdapter', () => {
  let driver: MockedObject<IRedisDriver>;
  let metrics: IMetricsMock;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    driver = createMockDriver();
    metrics = { incrementCounter: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should preload all Lua scripts', async () => {
      // When
      await initAdapter(driver, baseOptions());

      // Then
      expect(driver.scriptLoad).toHaveBeenCalled();
      const loaded = driver.scriptLoad.mock.calls.map(([script]) => /-- session:([\w-]+)/.exec(script as string)?.[1]);
      expect(loaded).toEqual(expect.arrayContaining(['set', 'get', 'touch', 'destroy', 'reserve', 'count', 'range', 'activity']));
    });

    it('should wrap script loading failures in SessionStoreError', async () => {
      // Given
      driver.scriptLoad.mockRejectedValue(new Error('no redis'));
      const adapter = new RedisSessionStoreAdapter(driver, baseOptions(), undefined as never);

      // When / Then
      await expect(adapter.onModuleInit()).rejects.toThrow(SessionStoreError);
    });
  });

  describe('get', () => {
    it('should return the parsed session payload on hit', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        get: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          expect(args).toEqual([NOW, 0]);
          return [1, '{"cookie":{},"cart":[1,2]}', ''];
        },
      });

      // When
      const result = await adapter.get('sid-1');

      // Then
      expect(result).toEqual({ cookie: {}, cart: [1, 2] });
    });

    it('should return null on miss', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { get: () => [0] });

      // When / Then
      expect(await adapter.get('missing')).toBeNull();
    });

    it('should pass the absolute lifetime cap to the script', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ absoluteLifetimeMs: 3_600_000 }));
      routeEvalsha(driver, {
        get: (_keys, args) => {
          expect(args).toEqual([NOW, 3_600_000]);
          return [0];
        },
      });

      // When
      await adapter.get('sid-1');
    });

    it('should clean indexes, emit onExpiredByCap, and count the metric when the cap expired the session', async () => {
      // Given
      const onExpiredByCap = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ absoluteLifetimeMs: 1000, events: { onExpiredByCap } }), metrics);
      routeEvalsha(driver, { get: () => [-1, 'user-1'] });

      // When
      const result = await adapter.get('sid-1');

      // Then
      expect(result).toBeNull();
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-1', 'sid-1');
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-1');
      await vi.waitFor(() => expect(onExpiredByCap).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: 'user-1' }));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_destroyed_total', { reason: 'expired-by-cap' });
    });

    it('should self-heal by destroying the session when the payload is corrupt JSON', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        get: () => [1, '{corrupt', ''],
        destroy: () => [1, ''],
      });

      // When
      const result = await adapter.get('sid-1');

      // Then
      expect(result).toBeNull();
      expect(driver.evalsha).toHaveBeenCalledWith('sha:destroy', ['sess:{sid-1}', 'sess:{sid-1}:meta'], expect.any(Array));
    });

    it('should fall back to eval when evalsha reports NOSCRIPT', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      driver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue([0]);

      // When
      const result = await adapter.get('sid-1');

      // Then
      expect(result).toBeNull();
      expect(driver.eval).toHaveBeenCalled();
    });

    it('should wrap driver failures in SessionStoreError', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      driver.evalsha.mockRejectedValue(new Error('connection reset'));
      driver.eval.mockRejectedValue(new Error('connection reset'));

      // When / Then
      await expect(adapter.get('sid-1')).rejects.toThrow(SessionStoreError);
    });
  });

  describe('set', () => {
    it('should write the session, index the global ZSET, and emit onCreated for a new session', async () => {
      // Given
      const onCreated = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onCreated } }), metrics);
      routeEvalsha(driver, {
        set: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          expect(args).toEqual(['{"cookie":{}}', 60_000, NOW, '', 0]);
          return [1, NOW + 60_000];
        },
      });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      expect(driver.zadd).toHaveBeenCalledWith('sess:index', NOW + 60_000, 'sid-1');
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: undefined }));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_created_total');
    });

    it('should not emit onCreated when overwriting an existing session', async () => {
      // Given
      const onCreated = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onCreated } }), metrics);
      routeEvalsha(driver, { set: () => [0, NOW + 60_000] });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      expect(onCreated).not.toHaveBeenCalled();
      expect(metrics.incrementCounter).not.toHaveBeenCalledWith('redisx_session_created_total');
    });

    it('should use the provided ttlMs over the default', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        set: (_keys, args) => {
          expect(args[1]).toBe(5_000);
          return [1, NOW + 5_000];
        },
      });

      // When
      await adapter.set('sid-1', { cookie: {} }, { ttlMs: 5_000 });
    });

    it('should index the session under its user when the extractor yields an id', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      const reserve = vi.fn((keys: string[], args: Array<string | number>) => {
        expect(keys).toEqual(['sess:user:user-7']);
        expect(args).toEqual(['sid-1', NOW + 60_000, NOW, 0, 0]);
        return [1, 1];
      });
      routeEvalsha(driver, {
        set: (_keys, args) => {
          expect(args[3]).toBe('user-7');
          return [1, NOW + 60_000];
        },
        reserve,
      });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      expect(reserve).toHaveBeenCalledTimes(1);
    });

    it('should not touch the user index for anonymous sessions', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      const reserve = vi.fn(() => [1, 1]);
      routeEvalsha(driver, { set: () => [1, NOW + 60_000], reserve });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      expect(reserve).not.toHaveBeenCalled();
    });

    it('should reject a new session over the seat limit under the reject policy without writing it', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' }), metrics);
      const set = vi.fn(() => [1, NOW + 60_000]);
      routeEvalsha(driver, {
        reserve: (keys, args) => {
          expect(keys).toEqual(['sess:user:user-7']);
          expect(args).toEqual(['sid-3', NOW + 60_000, NOW, 2, 1]);
          return [0, 2];
        },
        set,
      });

      // When / Then
      await expect(adapter.set('sid-3', { cookie: {}, passport: { user: 'user-7' } })).rejects.toThrow(SessionLimitExceededError);
      expect(set).not.toHaveBeenCalled();
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_limit_rejections_total');
    });

    it('should write the session when the reject-policy reservation is granted', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' }));
      const set = vi.fn(() => [1, NOW + 60_000]);
      routeEvalsha(driver, { reserve: () => [1, 2], set });

      // When
      await adapter.set('sid-2', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      expect(set).toHaveBeenCalledTimes(1);
    });

    it('should evict the oldest sessions over the limit under the evict-oldest policy', async () => {
      // Given
      const onRevoked = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'evict-oldest', events: { onRevoked } }), metrics);
      const destroyed: string[] = [];
      routeEvalsha(driver, {
        set: () => [1, NOW + 60_000],
        reserve: () => [1, 3],
        range: () => ['sid-old', 'sid-mid', 'sid-new'],
        destroy: (keys) => {
          destroyed.push(keys[0]!);
          return [1, 'user-7'];
        },
      });
      driver.hget.mockImplementation(async (key: string) => {
        if (key.includes('sid-old')) return String(NOW - 10_000);
        if (key.includes('sid-mid')) return String(NOW - 5_000);
        return String(NOW);
      });

      // When
      await adapter.set('sid-new', { cookie: {}, passport: { user: 'user-7' } });

      // Then: only the single oldest is evicted, never the session being written
      expect(destroyed).toEqual(['sess:{sid-old}']);
      await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledWith({ sessionId: 'sid-old', userId: 'user-7' }));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_destroyed_total', { reason: 'revoked' });
    });

    it('should treat a session already dead by the absolute cap as expired instead of indexing it', async () => {
      // Given
      const onExpiredByCap = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ absoluteLifetimeMs: 1000, events: { onExpiredByCap } }));
      routeEvalsha(driver, { set: () => [-1, 'user-7'] });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      expect(driver.zadd).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(onExpiredByCap).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: 'user-7' }));
    });

    it('should throw SessionSerializationError for unserializable payloads', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // When / Then
      await expect(adapter.set('sid-1', circular)).rejects.toThrow(SessionSerializationError);
    });

    it('should wrap a throwing userIdExtractor in SessionStoreError', async () => {
      // Given
      const adapter = await initAdapter(
        driver,
        baseOptions({
          userIdExtractor: () => {
            throw new Error('bad extractor');
          },
        }),
      );

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {} })).rejects.toThrow(SessionStoreError);
    });

    it('should survive a failing event callback', async () => {
      // Given
      const adapter = await initAdapter(
        driver,
        baseOptions({
          events: {
            onCreated: () => {
              throw new Error('listener bug');
            },
          },
        }),
      );
      routeEvalsha(driver, { set: () => [1, NOW + 60_000] });

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {} })).resolves.toBeUndefined();
    });
  });

  describe('touch', () => {
    it('should slide the TTL and refresh both index scores', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        touch: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          expect(args).toEqual([60_000, NOW, 0]);
          return [1, NOW + 60_000, 'user-7'];
        },
      });

      // When
      const result = await adapter.touch('sid-1');

      // Then
      expect(result).toBe(true);
      expect(driver.zadd).toHaveBeenCalledWith('sess:user:user-7', NOW + 60_000, 'sid-1');
      expect(driver.zadd).toHaveBeenCalledWith('sess:index', NOW + 60_000, 'sid-1');
    });

    it('should return false for a missing session', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { touch: () => [0] });

      // When / Then
      expect(await adapter.touch('gone')).toBe(false);
      expect(driver.zadd).not.toHaveBeenCalled();
    });

    it('should report cap expiry and clean indexes when the absolute lifetime is exceeded', async () => {
      // Given
      const onExpiredByCap = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ absoluteLifetimeMs: 1000, events: { onExpiredByCap } }), metrics);
      routeEvalsha(driver, { touch: () => [-1, 'user-7'] });

      // When
      const result = await adapter.touch('sid-1');

      // Then
      expect(result).toBe(false);
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-7', 'sid-1');
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-1');
      await vi.waitFor(() => expect(onExpiredByCap).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: 'user-7' }));
    });

    it('should wrap driver failures in SessionStoreError', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      driver.evalsha.mockRejectedValue(new Error('down'));
      driver.eval.mockRejectedValue(new Error('down'));

      // When / Then
      await expect(adapter.touch('sid-1')).rejects.toThrow(SessionStoreError);
    });
  });

  describe('destroy', () => {
    it('should remove the session and its index entries and emit onDestroyed by default', async () => {
      // Given
      const onDestroyed = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onDestroyed } }), metrics);
      routeEvalsha(driver, {
        destroy: (keys) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          return [1, 'user-7'];
        },
      });

      // When
      const result = await adapter.destroy('sid-1');

      // Then
      expect(result).toBe(true);
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-7', 'sid-1');
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-1');
      await vi.waitFor(() => expect(onDestroyed).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: 'user-7' }));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_destroyed_total', { reason: 'destroyed' });
    });

    it('should emit onRevoked when destroyed with the revoked reason', async () => {
      // Given
      const onRevoked = vi.fn();
      const onDestroyed = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onRevoked, onDestroyed } }), metrics);
      routeEvalsha(driver, { destroy: () => [1, 'user-7'] });

      // When
      await adapter.destroy('sid-1', 'revoked');

      // Then
      await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: 'user-7' }));
      expect(onDestroyed).not.toHaveBeenCalled();
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_destroyed_total', { reason: 'revoked' });
    });

    it('should return false and emit nothing for a missing session', async () => {
      // Given
      const onDestroyed = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onDestroyed } }), metrics);
      routeEvalsha(driver, { destroy: () => [0, ''] });

      // When / Then
      expect(await adapter.destroy('gone')).toBe(false);
      expect(onDestroyed).not.toHaveBeenCalled();
      expect(metrics.incrementCounter).not.toHaveBeenCalled();
    });
  });

  describe('metadata & activity', () => {
    it('should return parsed metadata', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      driver.hgetall.mockResolvedValue({ userId: 'user-1', createdAt: '1000', lastSeenAt: '2000', expiresAt: '3000' });

      // When
      const metadata = await adapter.getMetadata('sid-1');

      // Then
      expect(driver.hgetall).toHaveBeenCalledWith('sess:{sid-1}:meta');
      expect(metadata).toEqual({ userId: 'user-1', ip: undefined, userAgent: undefined, createdAt: 1000, lastSeenAt: 2000, expiresAt: 3000 });
    });

    it('should return null metadata for a missing session', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      driver.hgetall.mockResolvedValue({});

      // When / Then
      expect(await adapter.getMetadata('gone')).toBeNull();
    });

    it('should stamp ip, user agent, and lastSeenAt via the activity script', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        activity: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}:meta']);
          expect(args).toEqual([NOW, '10.0.0.1', 'curl/8']);
          return 1;
        },
      });

      // When
      await adapter.recordActivity('sid-1', { ip: '10.0.0.1', userAgent: 'curl/8' });
    });

    it('should pass empty strings for missing activity fields', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        activity: (_keys, args) => {
          expect(args).toEqual([NOW, '', '']);
          return 1;
        },
      });

      // When
      await adapter.recordActivity('sid-1', {});
    });
  });

  describe('counting & listing', () => {
    it('should count all active sessions via the global index', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        count: (keys, args) => {
          expect(keys).toEqual(['sess:index']);
          expect(args).toEqual([NOW]);
          return 42;
        },
      });

      // When / Then
      expect(await adapter.count()).toBe(42);
    });

    it('should count a user’s active sessions via the user index', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        count: (keys) => {
          expect(keys).toEqual(['sess:user:user-1']);
          return 2;
        },
      });

      // When / Then
      expect(await adapter.countByUser('user-1')).toBe(2);
    });

    it('should list a user’s active session ids', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        range: (keys, args) => {
          expect(keys).toEqual(['sess:user:user-1']);
          expect(args).toEqual([NOW]);
          return ['sid-1', 'sid-2'];
        },
      });

      // When / Then
      expect(await adapter.getUserSessionIds('user-1')).toEqual(['sid-1', 'sid-2']);
    });
  });
});
