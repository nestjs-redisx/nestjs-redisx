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

/** All evalsha invocations of the given script, as [keys, args] tuples. */
function callsOf(driver: MockedObject<IRedisDriver>, name: string): Array<[string[], Array<string | number>]> {
  return driver.evalsha.mock.calls.filter(([sha]) => sha === `sha:${name}`).map(([, keys, args]) => [keys as string[], args as Array<string | number>]);
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

  describe('session id validation', () => {
    it.each(['', '}evil'])('should reject the invalid session id %j without touching Redis', async (sid) => {
      // Given: '' and '}'-leading sids produce an empty cluster hash tag,
      // splitting payload and metadata across slots
      const adapter = await initAdapter(driver, baseOptions());

      // When / Then
      await expect(adapter.get(sid)).rejects.toThrow(SessionStoreError);
      await expect(adapter.set(sid, { cookie: {} })).rejects.toThrow(SessionStoreError);
      await expect(adapter.destroy(sid)).rejects.toThrow(SessionStoreError);
      expect(driver.evalsha).not.toHaveBeenCalled();
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

    it('should repair lost ownership: re-stamp userId and re-index on read', async () => {
      // Given: metadata lost its userId (eviction/TTL skew healed createdAt
      // only) — the payload still identifies the owner via the extractor
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        get: () => [1, '{"cookie":{},"passport":{"user":"user-7"}}', ''],
        reserve: () => [1, 1],
      });
      driver.hget.mockResolvedValue(String(NOW + 45_000));

      // When
      const result = await adapter.get('sid-1');

      // Then: identity restored and both indexes re-scored — revokeAll works again
      expect(result).toEqual({ cookie: {}, passport: { user: 'user-7' } });
      expect(driver.hset).toHaveBeenCalledWith('sess:{sid-1}:meta', 'userId', 'user-7');
      const reserves = callsOf(driver, 'reserve');
      expect(reserves).toContainEqual([['sess:user:user-7'], ['sid-1', NOW + 45_000, NOW, 0, 0]]);
      expect(reserves).toContainEqual([['sess:index'], ['sid-1', NOW + 45_000, NOW, 0, 0]]);
    });

    it('should not attempt ownership repair for anonymous sessions', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { get: () => [1, '{"cookie":{}}', ''] });

      // When
      await adapter.get('sid-1');

      // Then
      expect(driver.hset).not.toHaveBeenCalled();
    });

    it('should never fail a read because ownership repair failed', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { get: () => [1, '{"cookie":{},"passport":{"user":"user-7"}}', ''] });
      driver.hset.mockRejectedValue(new Error('down'));

      // When / Then: the payload is still served
      expect(await adapter.get('sid-1')).toEqual({ cookie: {}, passport: { user: 'user-7' } });
    });
  });

  describe('set', () => {
    it('should write the session, refresh the global index (with TTL), and emit onCreated for a new session', async () => {
      // Given
      const onCreated = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onCreated } }), metrics);
      routeEvalsha(driver, {
        set: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          expect(args).toEqual(['{"cookie":{}}', 60_000, NOW, '', 0]);
          return [1, NOW + 60_000, ''];
        },
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then: the global index goes through the reserve script (score + key TTL)
      expect(callsOf(driver, 'reserve')).toEqual([[['sess:index'], ['sid-1', NOW + 60_000, NOW, 0, 0]]]);
      expect(driver.zadd).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ sessionId: 'sid-1', userId: undefined }));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_session_created_total');
    });

    it('should not emit onCreated when overwriting an existing session', async () => {
      // Given
      const onCreated = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ events: { onCreated } }), metrics);
      routeEvalsha(driver, { set: () => [0, NOW + 60_000, ''], reserve: () => [1, 1] });

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
          return [1, NOW + 5_000, ''];
        },
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {} }, { ttlMs: 5_000 });
    });

    it('should floor fractional TTLs before they reach Redis', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        set: (_keys, args) => {
          expect(args[1]).toBe(1_000);
          return [1, NOW + 1_000, ''];
        },
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {} }, { ttlMs: 1_000.7 });
    });

    it.each([Number.NaN, 0, -5, Number.POSITIVE_INFINITY, 1e21, Number.MAX_SAFE_INTEGER])('should reject the invalid TTL %s without writing anything', async (ttlMs) => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {} }, { ttlMs })).rejects.toThrow(SessionStoreError);
      expect(driver.evalsha).not.toHaveBeenCalled();
    });

    it('should reject null and undefined payloads', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());

      // When / Then
      await expect(adapter.set('sid-1', null)).rejects.toThrow(SessionSerializationError);
      await expect(adapter.set('sid-1', undefined)).rejects.toThrow(SessionSerializationError);
      expect(driver.evalsha).not.toHaveBeenCalled();
    });

    it('should index the session under its user with the actual expiry', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        set: (_keys, args) => {
          expect(args[3]).toBe('user-7');
          return [1, NOW + 60_000, ''];
        },
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      const reserves = callsOf(driver, 'reserve');
      expect(reserves).toContainEqual([['sess:user:user-7'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
      expect(reserves).toContainEqual([['sess:index'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
    });

    it('should not touch the user index for anonymous sessions', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { set: () => [1, NOW + 60_000, ''], reserve: () => [1, 1] });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      const userReserves = callsOf(driver, 'reserve').filter(([keys]) => keys[0]!.startsWith('sess:user:'));
      expect(userReserves).toEqual([]);
    });

    it.each([
      ['empty string', { passport: { user: '' } }],
      ['whitespace-free object', { passport: { user: {} } }],
    ])('should treat a %s user id as anonymous', async (_label, session) => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ userIdExtractor: (s) => (s as { passport?: { user?: unknown } }).passport?.user as never }));
      routeEvalsha(driver, { set: () => [1, NOW + 60_000, ''], reserve: () => [1, 1] });

      // When
      await adapter.set('sid-1', { cookie: {}, ...session });

      // Then
      const userReserves = callsOf(driver, 'reserve').filter(([keys]) => keys[0]!.startsWith('sess:user:'));
      expect(userReserves).toEqual([]);
    });

    it('should stringify a finite numeric user id from a custom extractor', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ userIdExtractor: () => 42 as never }));
      routeEvalsha(driver, {
        set: (_keys, args) => {
          expect(args[3]).toBe('42');
          return [1, NOW + 60_000, ''];
        },
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      expect(callsOf(driver, 'reserve')).toContainEqual([['sess:user:42'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
    });

    it('should remove the sid from the previous owner’s index when the user changes', async () => {
      // Given: same sid re-saved under a different user (account switch)
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        set: () => [0, NOW + 60_000, 'alice'],
        reserve: () => [1, 1],
      });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'bob' } });

      // Then
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:alice', 'sid-1');
      expect(callsOf(driver, 'reserve')).toContainEqual([['sess:user:bob'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
    });

    it('should de-index the sid entirely when the session becomes anonymous', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { set: () => [0, NOW + 60_000, 'alice'], reserve: () => [1, 1] });

      // When
      await adapter.set('sid-1', { cookie: {} });

      // Then
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:alice', 'sid-1');
    });

    it('should reject a new session over the seat limit under the reject policy without writing it', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' }), metrics);
      const set = vi.fn(() => [1, NOW + 60_000, '']);
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

    it('should clamp the reject-policy reservation to the absolute lifetime cap', async () => {
      // Given: 1-day TTL but only 1s of cap — the index score must not outlive
      // the session by a day (zombie seat lockout)
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject', absoluteLifetimeMs: 1_000, defaultTtlMs: 86_400_000 }));
      const reserveArgs: Array<Array<string | number>> = [];
      routeEvalsha(driver, {
        reserve: (_keys, args) => {
          reserveArgs.push(args);
          return [1, 1];
        },
        set: () => [1, NOW + 1_000, ''],
      });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } });

      // Then: pre-reservation is capped, and the index is refreshed with the
      // actual expiry after the write
      expect(reserveArgs[0]).toEqual(['sid-1', NOW + 1_000, NOW, 1, 1]);
      expect(reserveArgs).toContainEqual(['sid-1', NOW + 1_000, NOW, 0, 0]);
    });

    it('should refresh the user index with the actual expiry after a granted reject-policy write', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' }));
      routeEvalsha(driver, {
        reserve: () => [1, 2],
        set: () => [1, NOW + 60_000, ''],
      });

      // When
      await adapter.set('sid-2', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      const userReserves = callsOf(driver, 'reserve').filter(([keys]) => keys[0] === 'sess:user:user-7');
      expect(userReserves).toHaveLength(2);
      expect(userReserves[1]![1]).toEqual(['sid-2', NOW + 60_000, NOW, 0, 0]);
    });

    it('should release the reserved seat when the write fails and no session exists', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject' }));
      driver.exists.mockResolvedValue(0);
      routeEvalsha(driver, {
        reserve: () => [1, 1],
        set: () => {
          throw new Error('connection reset');
        },
      });

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } })).rejects.toThrow(SessionStoreError);
      expect(driver.exists).toHaveBeenCalledWith('sess:{sid-1}');
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-7', 'sid-1');
    });

    it('should NOT release the seat when a session is actually live after a failed write', async () => {
      // Given: a failed RE-SAVE (or a timed-out write that landed) — blindly
      // compensating would un-index a live session (unrevocable + limit bypass)
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject' }));
      driver.exists.mockResolvedValue(1);
      routeEvalsha(driver, {
        reserve: () => [1, 1],
        set: () => {
          throw new Error('READONLY You cannot write against a replica');
        },
      });

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } })).rejects.toThrow(SessionStoreError);
      expect(driver.zrem).not.toHaveBeenCalled();
    });

    it('should evict the oldest sessions over the limit under the evict-oldest policy', async () => {
      // Given
      const onRevoked = vi.fn();
      const adapter = await initAdapter(driver, baseOptions({ maxSessionsPerUser: 2, maxSessionsPolicy: 'evict-oldest', events: { onRevoked } }), metrics);
      const destroyed: string[] = [];
      routeEvalsha(driver, {
        set: () => [1, NOW + 60_000, ''],
        reserve: (keys) => (keys[0] === 'sess:index' ? [1, 1] : [1, 3]),
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
      routeEvalsha(driver, { set: () => [-1] });

      // When
      await adapter.set('sid-1', { cookie: {}, passport: { user: 'user-7' } });

      // Then
      expect(callsOf(driver, 'reserve')).toEqual([]);
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
      routeEvalsha(driver, { set: () => [1, NOW + 60_000, ''], reserve: () => [1, 1] });

      // When / Then
      await expect(adapter.set('sid-1', { cookie: {} })).resolves.toBeUndefined();
    });

    it('should survive a throwing metrics service', async () => {
      // Given
      metrics.incrementCounter.mockImplementation(() => {
        throw new Error('registry gone');
      });
      const adapter = await initAdapter(driver, baseOptions(), metrics);
      routeEvalsha(driver, { set: () => [1, NOW + 60_000, ''], reserve: () => [1, 1] });

      // When / Then: the write must not be converted into an error
      await expect(adapter.set('sid-1', { cookie: {} })).resolves.toBeUndefined();
    });
  });

  describe('touch', () => {
    it('should slide the TTL and refresh both index entries AND their key TTLs', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, {
        touch: (keys, args) => {
          expect(keys).toEqual(['sess:{sid-1}', 'sess:{sid-1}:meta']);
          expect(args).toEqual([60_000, NOW, 0]);
          return [1, NOW + 60_000, 'user-7'];
        },
        reserve: () => [1, 1],
      });

      // When
      const result = await adapter.touch('sid-1');

      // Then: index refresh goes through the reserve script (bare zadd would
      // let the index KEY expire under rolling sessions — revokeAll would
      // silently stop working)
      expect(result).toBe(true);
      const reserves = callsOf(driver, 'reserve');
      expect(reserves).toContainEqual([['sess:user:user-7'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
      expect(reserves).toContainEqual([['sess:index'], ['sid-1', NOW + 60_000, NOW, 0, 0]]);
      expect(driver.zadd).not.toHaveBeenCalled();
    });

    it('should return false for a missing session', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { touch: () => [0] });

      // When / Then
      expect(await adapter.touch('gone')).toBe(false);
      expect(callsOf(driver, 'reserve')).toEqual([]);
    });

    it.each([Number.NaN, 0, -5, 1e21])('should reject the invalid TTL %s', async (ttlMs) => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());

      // When / Then
      await expect(adapter.touch('sid-1', { ttlMs })).rejects.toThrow(SessionStoreError);
      expect(driver.evalsha).not.toHaveBeenCalled();
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

    it('should re-derive the owner from the payload when metadata was lost', async () => {
      // Given: metadata evicted, payload intact — destroy is the only public
      // repair path, so it must not leave a phantom seat behind
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { destroy: () => [1, '', '{"cookie":{},"passport":{"user":"user-7"}}'] });

      // When
      const result = await adapter.destroy('sid-1');

      // Then
      expect(result).toBe(true);
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-7', 'sid-1');
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-1');
    });

    it('should tolerate an unparseable payload while recovering the owner', async () => {
      // Given
      const adapter = await initAdapter(driver, baseOptions());
      routeEvalsha(driver, { destroy: () => [1, '', '{corrupt'] });

      // When / Then: still destroyed, global index still cleaned
      expect(await adapter.destroy('sid-1')).toBe(true);
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-1');
    });

    it('should clean the owner index even when only metadata remained (phantom repair)', async () => {
      // Given: payload gone (evicted) but metadata + index entry linger — destroy
      // is the public repair path and must not discard the owner it just read
      const adapter = await initAdapter(driver, baseOptions(), metrics);
      routeEvalsha(driver, { destroy: () => [0, 'user-7', ''] });

      // When
      const result = await adapter.destroy('sid-ghost');

      // Then: reported as non-existent, but the phantom seat is freed
      expect(result).toBe(false);
      expect(driver.zrem).toHaveBeenCalledWith('sess:user:user-7', 'sid-ghost');
      expect(driver.zrem).toHaveBeenCalledWith('sess:index', 'sid-ghost');
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
