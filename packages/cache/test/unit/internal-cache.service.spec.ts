import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CacheService } from '../../src/cache/application/services/cache.service';
import type { IRedisDriver } from '@nestjs-redisx/core';
import type { IL1CacheStore } from '../../src/cache/application/ports/l1-cache-store.port';
import type { IL2CacheStore } from '../../src/cache/application/ports/l2-cache-store.port';
import type { IStampedeProtection } from '../../src/stampede/application/ports/stampede-protection.port';
import type { ITagIndex } from '../../src/tags/application/ports/tag-index.port';
import type { ISwrManager } from '../../src/swr/application/ports/swr-manager.port';
import type { ICachePluginOptions } from '../../src/shared/types';
import { CacheEntry } from '../../src/cache/domain/value-objects/cache-entry.vo';

describe('CacheService (Internal)', () => {
  let service: CacheService;
  let mockDriver: MockedObject<IRedisDriver>;
  let mockL1Store: MockedObject<IL1CacheStore>;
  let mockL2Store: MockedObject<IL2CacheStore>;
  let mockStampede: MockedObject<IStampedeProtection>;
  let mockTagIndex: MockedObject<ITagIndex>;
  let mockSwrManager: MockedObject<ISwrManager>;
  let options: ICachePluginOptions;

  beforeEach(() => {
    mockDriver = {
      pipeline: vi.fn().mockReturnValue({
        del: vi.fn(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as MockedObject<IRedisDriver>;

    mockL1Store = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(false),
      has: vi.fn().mockResolvedValue(false),
      clear: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
    } as unknown as MockedObject<IL1CacheStore>;

    mockL2Store = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(false),
      has: vi.fn().mockResolvedValue(false),
      clear: vi.fn().mockResolvedValue(undefined),
      getMany: vi.fn().mockResolvedValue([]),
      setMany: vi.fn().mockResolvedValue(undefined),
      ttl: vi.fn().mockResolvedValue(-1),
      getSwr: vi.fn().mockResolvedValue(null),
      setSwr: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({ hits: 0, misses: 0 }),
    } as unknown as MockedObject<IL2CacheStore>;

    mockStampede = {
      protect: vi.fn().mockImplementation(async (key, loader) => ({
        value: await loader(),
        cached: false,
        waited: false,
      })),
      getStats: vi.fn().mockReturnValue({ prevented: 0 }),
    } as unknown as MockedObject<IStampedeProtection>;

    mockTagIndex = {
      addKeyToTags: vi.fn().mockResolvedValue(undefined),
      getKeysByTag: vi.fn().mockResolvedValue([]),
      invalidateTag: vi.fn().mockResolvedValue(0),
      clearAllTags: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<ITagIndex>;

    mockSwrManager = {
      isExpired: vi.fn().mockReturnValue(false),
      isStale: vi.fn().mockReturnValue(false),
      shouldRevalidate: vi.fn().mockReturnValue(false),
      scheduleRevalidation: vi.fn(),
      createSwrEntry: vi.fn().mockImplementation((value, ttl, staleTime) => ({
        value,
        cachedAt: Date.now(),
        ttl,
        staleTime,
      })),
    } as unknown as MockedObject<ISwrManager>;

    options = {
      l1: { enabled: true, ttl: 60 },
      l2: { enabled: true, defaultTtl: 3600, maxTtl: 86400, keyPrefix: 'cache:' },
      stampede: { enabled: true },
      swr: { enabled: false },
      tags: { enabled: true },
    };

    service = new CacheService(mockDriver, mockL1Store, mockL2Store, mockStampede, mockTagIndex, mockSwrManager, options);
  });

  describe('get', () => {
    it('should return value from L1 cache on hit', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      mockL1Store.get.mockResolvedValue(entry);

      // When
      const result = await service.get(key);

      // Then
      expect(result).toBe('test-value');
      expect(mockL1Store.get).toHaveBeenCalledWith(key);
      expect(mockL2Store.get).not.toHaveBeenCalled();
    });

    it('should return value from L2 cache on L1 miss', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(entry);

      // When
      const result = await service.get(key);

      // Then
      expect(result).toBe('test-value');
      expect(mockL1Store.get).toHaveBeenCalledWith(key);
      expect(mockL2Store.get).toHaveBeenCalledWith(key);
    });

    it('should populate L1 from L2 on L2 hit', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('test-value', 60);
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(entry);

      // When
      await service.get(key);

      // Then
      expect(mockL1Store.set).toHaveBeenCalledWith(key, entry, 60);
    });

    it('should return null on cache miss', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);

      // When
      const result = await service.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should return null on validation error', async () => {
      // Given
      const key = '';

      // When
      const result = await service.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should return null on cache error', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.get.mockRejectedValue(new Error('Cache error'));

      // When
      const result = await service.get(key);

      // Then
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value in both L1 and L2 by default', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';

      // When
      await service.set(key, value);

      // Then
      expect(mockL2Store.set).toHaveBeenCalled();
      expect(mockL1Store.set).toHaveBeenCalled();
    });

    it('should use provided TTL', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';
      const ttl = 1800;

      // When
      await service.set(key, value, { ttl });

      // Then
      expect(mockL2Store.set).toHaveBeenCalledWith(key, expect.any(Object), ttl);
    });

    it('should use default TTL when not provided', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';

      // When
      await service.set(key, value);

      // Then
      expect(mockL2Store.set).toHaveBeenCalledWith(key, expect.any(Object), 3600);
    });

    it('should set only in L1 when strategy is l1-only', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';

      // When
      await service.set(key, value, { strategy: 'l1-only' });

      // Then
      expect(mockL1Store.set).toHaveBeenCalled();
      expect(mockL2Store.set).not.toHaveBeenCalled();
    });

    it('should set only in L2 when strategy is l2-only', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';

      // When
      await service.set(key, value, { strategy: 'l2-only' });

      // Then
      expect(mockL2Store.set).toHaveBeenCalled();
      expect(mockL1Store.set).not.toHaveBeenCalled();
    });

    it('should add tags to tag index', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';
      const tags = ['tag1', 'tag2'];

      // When
      await service.set(key, value, { tags });

      // Then
      expect(mockTagIndex.addKeyToTags).toHaveBeenCalledWith('cache:test-key', tags);
    });

    it('should not add tags for l1-only strategy', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';
      const tags = ['tag1', 'tag2'];

      // When
      await service.set(key, value, { tags, strategy: 'l1-only' });

      // Then
      expect(mockTagIndex.addKeyToTags).not.toHaveBeenCalled();
    });

    it('should throw on invalid key', async () => {
      // Given
      const key = '';
      const value = 'test-value';

      // When/Then
      await expect(service.set(key, value)).rejects.toThrow(/cannot be empty/i);
    });

    it('should throw on invalid TTL', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';
      const ttl = -1;

      // When/Then
      await expect(service.set(key, value, { ttl })).rejects.toThrow(/must be positive/i);
    });

    it('should throw on TTL exceeding max', async () => {
      // Given
      const key = 'test-key';
      const value = 'test-value';
      const ttl = 100000;

      // When/Then
      await expect(service.set(key, value, { ttl })).rejects.toThrow(/exceeds maximum/i);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      // Given
      const key = 'test-key';
      const entry = CacheEntry.create('cached-value', 60);
      mockL1Store.get.mockResolvedValue(entry);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      const result = await service.getOrSet(key, loader);

      // Then
      expect(result).toBe('cached-value');
      expect(loader).not.toHaveBeenCalled();
    });

    it('should load and cache value on miss', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      const result = await service.getOrSet(key, loader);

      // Then
      expect(result).toBe('loaded-value');
      expect(loader).toHaveBeenCalled();
      expect(mockL2Store.set).toHaveBeenCalled();
    });

    it('should use stampede protection by default', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      await service.getOrSet(key, loader);

      // Then
      expect(mockStampede.protect).toHaveBeenCalledWith(key, loader);
    });

    it('should skip stampede protection when requested', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      await service.getOrSet(key, loader, { skipStampede: true });

      // Then
      expect(mockStampede.protect).not.toHaveBeenCalled();
      expect(loader).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete from both L1 and L2', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.delete.mockResolvedValue(true);
      mockL2Store.delete.mockResolvedValue(true);

      // When
      const result = await service.delete(key);

      // Then
      expect(result).toBe(true);
      expect(mockL1Store.delete).toHaveBeenCalledWith(key);
      expect(mockL2Store.delete).toHaveBeenCalledWith(key);
    });

    it('should return true if deleted from any store', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.delete.mockResolvedValue(false);
      mockL2Store.delete.mockResolvedValue(true);

      // When
      const result = await service.delete(key);

      // Then
      expect(result).toBe(true);
    });

    it('should return false if not deleted from any store', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.delete.mockResolvedValue(false);
      mockL2Store.delete.mockResolvedValue(false);

      // When
      const result = await service.delete(key);

      // Then
      expect(result).toBe(false);
    });

    it('should throw on invalid key', async () => {
      // Given
      const key = '';

      // When/Then
      await expect(service.delete(key)).rejects.toThrow(/cannot be empty/i);
    });
  });

  describe('deleteMany', () => {
    it('should return 0 for empty array', async () => {
      // Given
      const keys: string[] = [];

      // When
      const result = await service.deleteMany(keys);

      // Then
      expect(result).toBe(0);
    });

    it('should delete multiple keys from L1', async () => {
      // Given
      const keys = ['key1', 'key2', 'key3'];
      mockL1Store.delete.mockResolvedValue(true);

      // When
      await service.deleteMany(keys);

      // Then
      expect(mockL1Store.delete).toHaveBeenCalledTimes(3);
    });

    it('should use pipeline for L2 deletion', async () => {
      // Given
      const keys = ['key1', 'key2'];
      const mockPipeline = {
        del: vi.fn(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };
      mockDriver.pipeline.mockReturnValue(mockPipeline as any);

      // When
      const result = await service.deleteMany(keys);

      // Then
      expect(mockDriver.pipeline).toHaveBeenCalled();
      expect(mockPipeline.del).toHaveBeenCalledTimes(2);
      expect(result).toBe(2);
    });

    it('should handle invalid keys gracefully', async () => {
      // Given
      const keys = ['', 'valid-key'];
      mockL1Store.delete.mockResolvedValue(true);
      const mockPipeline = {
        del: vi.fn(),
        exec: vi.fn().mockResolvedValue([[null, 1]]),
      };
      mockDriver.pipeline.mockReturnValue(mockPipeline as any);

      // When
      const result = await service.deleteMany(keys);

      // Then
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear L1, L2, and tag index', async () => {
      // Given/When
      await service.clear();

      // Then
      expect(mockL1Store.clear).toHaveBeenCalled();
      expect(mockL2Store.clear).toHaveBeenCalled();
      expect(mockTagIndex.clearAllTags).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      // Given
      mockL1Store.clear.mockRejectedValue(new Error('Clear error'));

      // When/Then
      await expect(service.clear()).rejects.toThrow(/Clear error/i);
    });
  });

  describe('has', () => {
    it('should return true if found in L1', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.has.mockResolvedValue(true);

      // When
      const result = await service.has(key);

      // Then
      expect(result).toBe(true);
      expect(mockL2Store.has).not.toHaveBeenCalled();
    });

    it('should check L2 if not in L1', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.has.mockResolvedValue(false);
      mockL2Store.has.mockResolvedValue(true);

      // When
      const result = await service.has(key);

      // Then
      expect(result).toBe(true);
      expect(mockL2Store.has).toHaveBeenCalledWith(key);
    });

    it('should return false if not found', async () => {
      // Given
      const key = 'test-key';
      mockL1Store.has.mockResolvedValue(false);
      mockL2Store.has.mockResolvedValue(false);

      // When
      const result = await service.has(key);

      // Then
      expect(result).toBe(false);
    });

    it('should return false on validation error', async () => {
      // Given
      const key = '';

      // When
      const result = await service.has(key);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('invalidateTag', () => {
    it('should invalidate tag and return count', async () => {
      // Given
      const tag = 'test-tag';
      mockTagIndex.getKeysByTag.mockResolvedValue(['cache:key1', 'cache:key2']);
      mockTagIndex.invalidateTag.mockResolvedValue(2);

      // When
      const result = await service.invalidateTag(tag);

      // Then
      expect(result).toBe(2);
      expect(mockTagIndex.invalidateTag).toHaveBeenCalledWith(tag);
    });

    it('should delete keys from L1', async () => {
      // Given
      const tag = 'test-tag';
      mockTagIndex.getKeysByTag.mockResolvedValue(['cache:key1', 'cache:key2']);
      mockTagIndex.invalidateTag.mockResolvedValue(2);

      // When
      await service.invalidateTag(tag);

      // Then
      expect(mockL1Store.delete).toHaveBeenCalledWith('key1');
      expect(mockL1Store.delete).toHaveBeenCalledWith('key2');
    });

    it('should return 0 when tags disabled', async () => {
      // Given
      const serviceWithoutTags = new CacheService(mockDriver, mockL1Store, mockL2Store, mockStampede, mockTagIndex, mockSwrManager, { ...options, tags: { enabled: false } });

      // When
      const result = await serviceWithoutTags.invalidateTag('test-tag');

      // Then
      expect(result).toBe(0);
    });
  });

  describe('invalidateTags', () => {
    it('should invalidate multiple tags', async () => {
      // Given
      const tags = ['tag1', 'tag2'];
      mockTagIndex.getKeysByTag.mockResolvedValue([]);
      mockTagIndex.invalidateTag.mockResolvedValue(5);

      // When
      const result = await service.invalidateTags(tags);

      // Then
      expect(result).toBe(10);
      expect(mockTagIndex.invalidateTag).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for empty array', async () => {
      // Given
      const tags: string[] = [];

      // When
      const result = await service.invalidateTags(tags);

      // Then
      expect(result).toBe(0);
    });
  });

  describe('getMany', () => {
    it('should return values for multiple keys', async () => {
      // Given
      const keys = ['key1', 'key2'];
      const entries = [CacheEntry.create('value1', 60), CacheEntry.create('value2', 60)];
      mockL2Store.getMany.mockResolvedValue(entries);

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual(['value1', 'value2']);
    });

    it('should return null for missing keys', async () => {
      // Given
      const keys = ['key1', 'key2'];
      mockL2Store.getMany.mockResolvedValue([CacheEntry.create('value1', 60), null]);

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual(['value1', null]);
    });

    it('should return empty array for empty input', async () => {
      // Given
      const keys: string[] = [];

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual([]);
    });

    it('should handle invalid keys', async () => {
      // Given
      const keys = ['', 'valid-key'];
      mockL2Store.getMany.mockResolvedValue([CacheEntry.create('value', 60)]);

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result.length).toBe(2);
    });

    it('should return all nulls when getMany fails', async () => {
      // Given
      const keys = ['key1', 'key2', 'key3'];
      mockL2Store.getMany.mockRejectedValue(new Error('Redis connection error'));

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual([null, null, null]);
    });

    it('should return all nulls when all keys are invalid', async () => {
      // Given
      const keys = ['', '', ''];

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual([null, null, null]);
      expect(mockL2Store.getMany).not.toHaveBeenCalled();
    });
  });

  describe('setMany', () => {
    it('should set multiple entries', async () => {
      // Given
      const entries = [
        { key: 'key1', value: 'value1', ttl: 60 },
        { key: 'key2', value: 'value2', ttl: 120 },
      ];

      // When
      await service.setMany(entries);

      // Then
      expect(mockL2Store.setMany).toHaveBeenCalled();
    });

    it('should add tags for entries with tags', async () => {
      // Given
      const entries = [{ key: 'key1', value: 'value1', tags: ['tag1'] }];

      // When
      await service.setMany(entries);

      // Then
      expect(mockTagIndex.addKeyToTags).toHaveBeenCalledWith('cache:key1', ['tag1']);
    });

    it('should handle empty array', async () => {
      // Given
      const entries: any[] = [];

      // When
      await service.setMany(entries);

      // Then
      expect(mockL2Store.setMany).not.toHaveBeenCalled();
    });

    it('should throw CacheKeyError when key validation fails', async () => {
      // Given
      const entries = [
        { key: '', value: 'value1' }, // Invalid empty key
      ];

      // When/Then
      try {
        await service.setMany(entries);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheError when setMany operation fails', async () => {
      // Given
      const entries = [{ key: 'key1', value: 'value1' }];
      mockL2Store.setMany.mockRejectedValue(new Error('Redis connection error'));

      // When/Then
      try {
        await service.setMany(entries);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/Failed to setMany/);
      }
    });

    it('should return early when L2 is disabled', async () => {
      // Given
      const serviceWithoutL2 = new CacheService(mockDriver, mockL1Store, mockL2Store, mockStampede, mockTagIndex, mockSwrManager, { ...options, l2: { enabled: false } });
      const entries = [{ key: 'key1', value: 'value1' }];

      // When
      await serviceWithoutL2.setMany(entries);

      // Then
      expect(mockL2Store.setMany).not.toHaveBeenCalled();
    });
  });

  describe('ttl', () => {
    it('should return TTL from L2', async () => {
      // Given
      const key = 'test-key';
      mockL2Store.ttl.mockResolvedValue(3600);

      // When
      const result = await service.ttl(key);

      // Then
      expect(result).toBe(3600);
    });

    it('should return -1 when L2 disabled', async () => {
      // Given
      const serviceWithoutL2 = new CacheService(mockDriver, mockL1Store, mockL2Store, mockStampede, mockTagIndex, mockSwrManager, { ...options, l2: { enabled: false } });

      // When
      const result = await serviceWithoutL2.ttl('test-key');

      // Then
      expect(result).toBe(-1);
    });

    it('should return -1 on validation error', async () => {
      // Given
      const key = '';

      // When
      const result = await service.ttl(key);

      // Then
      expect(result).toBe(-1);
    });
  });

  describe('getStats', () => {
    it('should return combined stats', async () => {
      // Given
      mockL1Store.getStats.mockReturnValue({ hits: 10, misses: 5, size: 100 });
      mockL2Store.getStats.mockResolvedValue({ hits: 20, misses: 10 });
      mockStampede.getStats.mockReturnValue({ prevented: 3 });

      // When
      const result = await service.getStats();

      // Then
      expect(result).toEqual({
        l1: { hits: 10, misses: 5, size: 100 },
        l2: { hits: 20, misses: 10 },
        stampedePrevented: 3,
      });
    });
  });

  describe('context enrichment (varyBy)', () => {
    let contextService: CacheService;
    const mockContextProvider = {
      get: vi.fn(),
    };

    beforeEach(() => {
      mockContextProvider.get.mockReset();
      contextService = new CacheService(mockDriver, mockL1Store, mockL2Store, mockStampede, mockTagIndex, mockSwrManager, {
        ...options,
        contextProvider: mockContextProvider,
        contextKeys: ['tenantId', 'locale'],
      });
    });

    it('should enrich key with global context keys in get()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'tenant-abc';
        if (key === 'locale') return 'en_US';
        return undefined;
      });
      const entry = CacheEntry.create('test-value', 60);
      mockL1Store.get.mockResolvedValue(entry);

      // When
      await contextService.get('user:profile');

      // Then — key should include context suffix (sorted alphabetically)
      expect(mockL1Store.get).toHaveBeenCalledWith('user:profile:_ctx_:locale.en_US:tenantId.tenant-abc');
    });

    it('should enrich key with global context keys in set()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'tenant-abc';
        return undefined;
      });

      // When
      await contextService.set('user:profile', 'value');

      // Then
      expect(mockL2Store.set).toHaveBeenCalledWith('user:profile:_ctx_:tenantId.tenant-abc', expect.any(Object), expect.any(Number));
    });

    it('should enrich key with varyBy in set()', async () => {
      // Given
      mockContextProvider.get.mockReturnValue(undefined);

      // When
      await contextService.set('user:profile', 'value', {
        varyBy: { region: 'us-east' },
      });

      // Then
      expect(mockL2Store.set).toHaveBeenCalledWith('user:profile:_ctx_:region.us-east', expect.any(Object), expect.any(Number));
    });

    it('should merge contextKeys and varyBy (varyBy overrides)', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'from-context';
        if (key === 'locale') return 'en_US';
        return undefined;
      });

      // When
      await contextService.set('user:profile', 'value', {
        varyBy: { tenantId: 'override-tenant' },
      });

      // Then — tenantId should be overridden by varyBy
      expect(mockL2Store.set).toHaveBeenCalledWith('user:profile:_ctx_:locale.en_US:tenantId.override-tenant', expect.any(Object), expect.any(Number));
    });

    it('should not enrich key when no context values available', async () => {
      // Given
      mockContextProvider.get.mockReturnValue(undefined);

      // When
      await contextService.set('user:profile', 'value');

      // Then — no context suffix added
      expect(mockL2Store.set).toHaveBeenCalledWith('user:profile', expect.any(Object), expect.any(Number));
    });

    it('should enrich keys consistently in getOrSet()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'abc';
        return undefined;
      });
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      await contextService.getOrSet('user:profile', loader);

      // Then — both get and set should use the same enriched key
      const enrichedKey = 'user:profile:_ctx_:tenantId.abc';
      expect(mockL1Store.get).toHaveBeenCalledWith(enrichedKey);
      expect(mockL2Store.get).toHaveBeenCalledWith(enrichedKey);
      expect(mockStampede.protect).toHaveBeenCalledWith(enrichedKey, loader);
    });

    it('should enrich key with varyBy in getOrSet()', async () => {
      // Given
      mockContextProvider.get.mockReturnValue(undefined);
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('loaded-value');

      // When
      await contextService.getOrSet('user:profile', loader, {
        varyBy: { region: 'eu' },
      });

      // Then
      const enrichedKey = 'user:profile:_ctx_:region.eu';
      expect(mockL1Store.get).toHaveBeenCalledWith(enrichedKey);
      expect(mockStampede.protect).toHaveBeenCalledWith(enrichedKey, loader);
    });

    it('should enrich key in delete()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'abc';
        return undefined;
      });
      mockL1Store.delete.mockResolvedValue(true);
      mockL2Store.delete.mockResolvedValue(true);

      // When
      await contextService.delete('user:profile');

      // Then
      const enrichedKey = 'user:profile:_ctx_:tenantId.abc';
      expect(mockL1Store.delete).toHaveBeenCalledWith(enrichedKey);
      expect(mockL2Store.delete).toHaveBeenCalledWith(enrichedKey);
    });

    it('should enrich key in has()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'abc';
        return undefined;
      });
      mockL1Store.has.mockResolvedValue(true);

      // When
      await contextService.has('user:profile');

      // Then
      expect(mockL1Store.has).toHaveBeenCalledWith('user:profile:_ctx_:tenantId.abc');
    });

    it('should enrich key in ttl()', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'abc';
        return undefined;
      });
      mockL2Store.ttl.mockResolvedValue(3600);

      // When
      await contextService.ttl('user:profile');

      // Then
      expect(mockL2Store.ttl).toHaveBeenCalledWith('user:profile:_ctx_:tenantId.abc');
    });

    it('should sanitize non-alphanumeric characters in context values', async () => {
      // Given
      mockContextProvider.get.mockImplementation((key: string) => {
        if (key === 'tenantId') return 'tenant@example.com';
        return undefined;
      });
      mockL1Store.get.mockResolvedValue(null);

      // When
      await contextService.get('user:profile');

      // Then — @ and . replaced with _
      expect(mockL1Store.get).toHaveBeenCalledWith('user:profile:_ctx_:tenantId.tenant_example_com');
    });

    it('should not enrich keys when contextProvider is not configured', async () => {
      // Given — use the default service (no contextProvider)
      mockL1Store.get.mockResolvedValue(null);

      // When
      await service.get('user:profile');

      // Then — key should not be enriched
      expect(mockL1Store.get).toHaveBeenCalledWith('user:profile');
    });

    it('should prevent double-enrichment via marker', async () => {
      // Given — key already has context marker
      mockContextProvider.get.mockReturnValue('abc');
      const alreadyEnrichedKey = 'user:profile:_ctx_:tenantId.abc';
      mockL1Store.get.mockResolvedValue(null);
      mockL2Store.get.mockResolvedValue(null);
      const loader = vi.fn().mockResolvedValue('value');

      // When — getOrSet enriches key, then calls get() which tries to enrich again
      await contextService.getOrSet('user:profile', loader);

      // Then — get() inside getOrSet should use the same enriched key (not double-enriched)
      const calls = mockL1Store.get.mock.calls;
      for (const [calledKey] of calls) {
        // Should never see double marker
        const markerCount = (calledKey as string).split(':_ctx_:').length - 1;
        expect(markerCount).toBeLessThanOrEqual(1);
      }
    });
  });
});
