import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { L2RedisStoreAdapter } from '../../src/cache/infrastructure/adapters/l2-redis-store.adapter';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { Serializer } from '../../src/cache/domain/services/serializer.service';
import { CacheEntry } from '../../src/cache/domain/value-objects/cache-entry.vo';
import type { ICachePluginOptions, SwrEntry } from '../../src/shared/types';

describe('L2RedisStoreAdapter (Full)', () => {
  let adapter: L2RedisStoreAdapter;
  let mockDriver: MockedObject<IRedisDriver>;
  let mockSerializer: Serializer;
  let options: ICachePluginOptions;

  beforeEach(() => {
    mockDriver = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      setex: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(0),
      exists: vi.fn().mockResolvedValue(0),
      ttl: vi.fn().mockResolvedValue(-2),
      expire: vi.fn().mockResolvedValue(1),
      scan: vi.fn().mockResolvedValue(['0', []]),
      mget: vi.fn().mockResolvedValue([]),
    } as unknown as MockedObject<IRedisDriver>;

    mockSerializer = new Serializer();

    options = {
      l2: {
        enabled: true,
        keyPrefix: 'cache:',
        defaultTtl: 3600,
        maxTtl: 86400,
      },
    };

    adapter = new L2RedisStoreAdapter(mockDriver, options, mockSerializer);
  });

  describe('get', () => {
    it('should return entry when key exists', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      const serialized = mockSerializer.serialize(entry);
      mockDriver.get.mockResolvedValue(serialized);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toBeDefined();
      expect(result?.value).toBe('test-value');
      expect(mockDriver.get).toHaveBeenCalledWith('cache:test-key');
    });

    it('should return null when key does not exist', async () => {
      // Given
      const key = 'test-key';
      mockDriver.get.mockResolvedValue(null);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should increment hits on cache hit', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      const serialized = mockSerializer.serialize(entry);
      mockDriver.get.mockResolvedValue(serialized);

      // When
      await adapter.get(key);
      const stats = await adapter.getStats();

      // Then
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should increment misses on cache miss', async () => {
      // Given
      const key = 'test-key';
      mockDriver.get.mockResolvedValue(null);

      // When
      await adapter.get(key);
      const stats = await adapter.getStats();

      // Then
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should return null on driver error', async () => {
      // Given
      const key = 'test-key';
      mockDriver.get.mockRejectedValue(new Error('Driver error'));

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set entry with default TTL', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);

      // When
      await adapter.set(key, entry);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:test-key', 3600, expect.any(String));
    });

    it('should set entry with custom TTL', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      const ttl = 1800;

      // When
      await adapter.set(key, entry, ttl);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:test-key', 1800, expect.any(String));
    });

    it('should throw on driver error', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      mockDriver.setex.mockRejectedValue(new Error('Driver error'));

      // When/Then
      await expect(adapter.set(key, entry)).rejects.toThrow(/Failed to set cache entry/);
    });
  });

  describe('delete', () => {
    it('should return true when key is deleted', async () => {
      // Given
      const key = 'test-key';
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await adapter.delete(key);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.del).toHaveBeenCalledWith('cache:test-key');
    });

    it('should return false when key does not exist', async () => {
      // Given
      const key = 'test-key';
      mockDriver.del.mockResolvedValue(0);

      // When
      const result = await adapter.delete(key);

      // Then
      expect(result).toBe(false);
    });

    it('should throw on driver error', async () => {
      // Given
      const key = 'test-key';
      mockDriver.del.mockRejectedValue(new Error('Driver error'));

      // When/Then
      await expect(adapter.delete(key)).rejects.toThrow(/Failed to delete cache entry/);
    });
  });

  describe('clear', () => {
    it('should delete all keys with prefix', async () => {
      // Given
      mockDriver.scan.mockResolvedValue(['0', ['cache:key1', 'cache:key2']]);
      mockDriver.del.mockResolvedValue(1);

      // When
      await adapter.clear();

      // Then
      expect(mockDriver.scan).toHaveBeenCalledWith(0, {
        match: 'cache:*',
        count: 100,
      });
      expect(mockDriver.del).toHaveBeenCalledTimes(2);
    });

    it('should handle empty result', async () => {
      // Given
      mockDriver.scan.mockResolvedValue(['0', []]);

      // When
      await adapter.clear();

      // Then
      expect(mockDriver.del).not.toHaveBeenCalled();
    });

    it('should process large batches', async () => {
      // Given
      const keys = Array.from({ length: 250 }, (_, i) => `cache:key${i}`);
      mockDriver.scan.mockResolvedValue(['0', keys]);
      mockDriver.del.mockResolvedValue(1);

      // When
      await adapter.clear();

      // Then
      expect(mockDriver.del).toHaveBeenCalledTimes(250);
    });

    it('should throw on driver error', async () => {
      // Given
      mockDriver.scan.mockRejectedValue(new Error('Scan error'));

      // When/Then
      await expect(adapter.clear()).rejects.toThrow(/Failed to clear cache/);
    });
  });

  describe('has', () => {
    it('should return true when key exists', async () => {
      // Given
      const key = 'test-key';
      mockDriver.exists.mockResolvedValue(1);

      // When
      const result = await adapter.has(key);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.exists).toHaveBeenCalledWith('cache:test-key');
    });

    it('should return false when key does not exist', async () => {
      // Given
      const key = 'test-key';
      mockDriver.exists.mockResolvedValue(0);

      // When
      const result = await adapter.has(key);

      // Then
      expect(result).toBe(false);
    });

    it('should return false on driver error', async () => {
      // Given
      const key = 'test-key';
      mockDriver.exists.mockRejectedValue(new Error('Driver error'));

      // When
      const result = await adapter.has(key);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('ttl', () => {
    it('should return TTL for existing key', async () => {
      // Given
      const key = 'test-key';
      mockDriver.ttl.mockResolvedValue(3600);

      // When
      const result = await adapter.ttl(key);

      // Then
      expect(result).toBe(3600);
      expect(mockDriver.ttl).toHaveBeenCalledWith('cache:test-key');
    });

    it('should return -2 for non-existent key', async () => {
      // Given
      const key = 'test-key';
      mockDriver.ttl.mockResolvedValue(-2);

      // When
      const result = await adapter.ttl(key);

      // Then
      expect(result).toBe(-2);
    });

    it('should return -1 on driver error', async () => {
      // Given
      const key = 'test-key';
      mockDriver.ttl.mockRejectedValue(new Error('Driver error'));

      // When
      const result = await adapter.ttl(key);

      // Then
      expect(result).toBe(-1);
    });
  });

  describe('expire', () => {
    it('should set expiration and return true', async () => {
      // Given
      const key = 'test-key';
      const ttl = 1800;
      mockDriver.expire.mockResolvedValue(1);

      // When
      const result = await adapter.expire(key, ttl);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.expire).toHaveBeenCalledWith('cache:test-key', 1800);
    });

    it('should return false when key does not exist', async () => {
      // Given
      const key = 'test-key';
      const ttl = 1800;
      mockDriver.expire.mockResolvedValue(0);

      // When
      const result = await adapter.expire(key, ttl);

      // Then
      expect(result).toBe(false);
    });

    it('should throw on driver error', async () => {
      // Given
      const key = 'test-key';
      const ttl = 1800;
      mockDriver.expire.mockRejectedValue(new Error('Driver error'));

      // When/Then
      await expect(adapter.expire(key, ttl)).rejects.toThrow(/Failed to set expiration/);
    });
  });

  describe('scan', () => {
    it('should scan keys with pattern', async () => {
      // Given
      const pattern = 'user:*';
      mockDriver.scan.mockResolvedValue(['0', ['cache:user:1', 'cache:user:2']]);

      // When
      const result = await adapter.scan(pattern);

      // Then
      expect(result.keys).toEqual(['user:1', 'user:2']);
      expect(result.cursor).toBe('0');
    });

    it('should handle empty result', async () => {
      // Given
      const pattern = 'user:*';
      mockDriver.scan.mockResolvedValue(['0', []]);

      // When
      const result = await adapter.scan(pattern);

      // Then
      expect(result.keys).toEqual([]);
    });

    it('should use custom count', async () => {
      // Given
      const pattern = 'user:*';
      const count = 50;
      mockDriver.scan.mockResolvedValue(['0', []]);

      // When
      await adapter.scan(pattern, count);

      // Then
      expect(mockDriver.scan).toHaveBeenCalledWith(0, {
        match: 'cache:user:*',
        count: 50,
      });
    });

    it('should throw on driver error', async () => {
      // Given
      const pattern = 'user:*';
      mockDriver.scan.mockRejectedValue(new Error('Scan error'));

      // When/Then
      await expect(adapter.scan(pattern)).rejects.toThrow(/Failed to scan keys/);
    });
  });

  describe('getMany', () => {
    it('should get multiple entries', async () => {
      // Given
      const keys = ['key1', 'key2'];
      const entry1 = CacheEntry.create('value1', 60);
      const entry2 = CacheEntry.create('value2', 60);
      const serialized1 = mockSerializer.serialize(entry1);
      const serialized2 = mockSerializer.serialize(entry2);
      mockDriver.mget.mockResolvedValue([serialized1, serialized2]);

      // When
      const result = await adapter.getMany(keys);

      // Then
      expect(result.length).toBe(2);
      expect(result[0]?.value).toBe('value1');
      expect(result[1]?.value).toBe('value2');
      expect(mockDriver.mget).toHaveBeenCalledWith('cache:key1', 'cache:key2');
    });

    it('should return null for missing keys', async () => {
      // Given
      const keys = ['key1', 'key2'];
      const entry1 = CacheEntry.create('value1', 60);
      const serialized1 = mockSerializer.serialize(entry1);
      mockDriver.mget.mockResolvedValue([serialized1, null]);

      // When
      const result = await adapter.getMany(keys);

      // Then
      expect(result[0]?.value).toBe('value1');
      expect(result[1]).toBeNull();
    });

    it('should return empty array for empty input', async () => {
      // Given
      const keys: string[] = [];

      // When
      const result = await adapter.getMany(keys);

      // Then
      expect(result).toEqual([]);
    });

    it('should return nulls on driver error', async () => {
      // Given
      const keys = ['key1', 'key2'];
      mockDriver.mget.mockRejectedValue(new Error('Driver error'));

      // When
      const result = await adapter.getMany(keys);

      // Then
      expect(result).toEqual([null, null]);
    });

    it('should update stats correctly', async () => {
      // Given
      const keys = ['key1', 'key2', 'key3'];
      const entry1 = CacheEntry.create('value1', 60);
      const serialized1 = mockSerializer.serialize(entry1);
      mockDriver.mget.mockResolvedValue([serialized1, null, serialized1]);

      // When
      await adapter.getMany(keys);
      const stats = await adapter.getStats();

      // Then
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe('setMany', () => {
    it('should set multiple entries', async () => {
      // Given
      const entries = [
        { key: 'key1', entry: CacheEntry.create('value1', 60), ttl: 1800 },
        { key: 'key2', entry: CacheEntry.create('value2', 60), ttl: 3600 },
      ];

      // When
      await adapter.setMany(entries);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledTimes(2);
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:key1', 1800, expect.any(String));
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:key2', 3600, expect.any(String));
    });

    it('should use default TTL when not provided', async () => {
      // Given
      const entries = [{ key: 'key1', entry: CacheEntry.create('value1', 60) }];

      // When
      await adapter.setMany(entries);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:key1', 3600, expect.any(String));
    });

    it('should handle empty array', async () => {
      // Given
      const entries: any[] = [];

      // When
      await adapter.setMany(entries);

      // Then
      expect(mockDriver.setex).not.toHaveBeenCalled();
    });

    it('should throw on driver error', async () => {
      // Given
      const entries = [{ key: 'key1', entry: CacheEntry.create('value1', 60) }];
      mockDriver.setex.mockRejectedValue(new Error('Driver error'));

      // When/Then
      await expect(adapter.setMany(entries)).rejects.toThrow(/Failed to set multiple cache entries/);
    });
  });

  describe('getSwr', () => {
    it('should return SWR entry when exists', async () => {
      // Given
      const key = 'test-key';
      const swrEntry: SwrEntry<string> = {
        value: 'test-value',
        cachedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        staleAt: Date.now() + 30000,
      };
      const serialized = mockSerializer.serialize(swrEntry);
      mockDriver.get.mockResolvedValue(serialized);

      // When
      const result = await adapter.getSwr(key);

      // Then
      expect(result).toBeDefined();
      expect(result?.value).toBe('test-value');
    });

    it('should return null when key does not exist', async () => {
      // Given
      const key = 'test-key';
      mockDriver.get.mockResolvedValue(null);

      // When
      const result = await adapter.getSwr(key);

      // Then
      expect(result).toBeNull();
    });

    it('should increment hits on cache hit', async () => {
      // Given
      const key = 'test-key';
      const swrEntry: SwrEntry<string> = {
        value: 'test-value',
        cachedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        staleAt: Date.now() + 30000,
      };
      const serialized = mockSerializer.serialize(swrEntry);
      mockDriver.get.mockResolvedValue(serialized);

      // When
      await adapter.getSwr(key);
      const stats = await adapter.getStats();

      // Then
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should return null on deserialization error', async () => {
      // Given
      const key = 'test-key';
      // Return invalid JSON that will cause deserialization to fail
      mockDriver.get.mockResolvedValue('{"invalid json');

      // When
      const result = await adapter.getSwr(key);

      // Then
      expect(result).toBeNull();
    });
  });

  describe('setSwr', () => {
    it('should set SWR entry with calculated TTL', async () => {
      // Given
      const key = 'test-key';
      const now = Date.now();
      const swrEntry: SwrEntry<string> = {
        value: 'test-value',
        cachedAt: now,
        expiresAt: now + 60000,
        staleAt: now + 30000,
      };

      // When
      await adapter.setSwr(key, swrEntry);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith('cache:test-key', expect.any(Number), expect.any(String));
    });

    it('should not save expired entry', async () => {
      // Given
      const key = 'test-key';
      const now = Date.now();
      const swrEntry: SwrEntry<string> = {
        value: 'test-value',
        cachedAt: now - 120000,
        expiresAt: now - 60000,
        staleAt: now - 90000,
      };

      // When
      await adapter.setSwr(key, swrEntry);

      // Then
      expect(mockDriver.setex).not.toHaveBeenCalled();
    });

    it('should throw on driver error', async () => {
      // Given
      const key = 'test-key';
      const now = Date.now();
      const swrEntry: SwrEntry<string> = {
        value: 'test-value',
        cachedAt: now,
        expiresAt: now + 60000,
        staleAt: now + 30000,
      };
      mockDriver.setex.mockRejectedValue(new Error('Driver error'));

      // When/Then
      await expect(adapter.setSwr(key, swrEntry)).rejects.toThrow(/Failed to set SWR entry/);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', async () => {
      // Given/When
      const stats = await adapter.getStats();

      // Then
      expect(stats).toEqual({
        hits: 0,
        misses: 0,
      });
    });

    it('should track hits and misses', async () => {
      // Given
      const entry = CacheEntry.create('value', 60);
      const serialized = mockSerializer.serialize(entry);
      mockDriver.get.mockResolvedValueOnce(serialized);
      mockDriver.get.mockResolvedValueOnce(null);
      mockDriver.get.mockResolvedValueOnce(serialized);

      // When
      await adapter.get('key1');
      await adapter.get('key2');
      await adapter.get('key3');
      const stats = await adapter.getStats();

      // Then
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });
});
