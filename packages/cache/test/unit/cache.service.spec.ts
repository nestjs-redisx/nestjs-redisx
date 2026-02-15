import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedObject } from 'vitest';
import { CacheService } from '../../src/cache.service';
import { ICacheService as IInternalCacheService } from '../../src/cache/application/ports/cache-service.port';

describe('CacheService', () => {
  let service: CacheService;
  let mockInternalCache: MockedObject<IInternalCacheService>;

  beforeEach(() => {
    mockInternalCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      getOrSet: vi.fn(),
      has: vi.fn(),
      ttl: vi.fn(),
      clear: vi.fn(),
      invalidateTag: vi.fn(),
      invalidateTags: vi.fn(),
      deleteMany: vi.fn(),
      getKeysByTag: vi.fn(),
      invalidateByPattern: vi.fn(),
      getStats: vi.fn(),
    } as unknown as MockedObject<IInternalCacheService>;

    service = new CacheService(mockInternalCache);
  });

  describe('get', () => {
    it('should get value from cache', async () => {
      // Given
      const key = 'user:123';
      const value = { id: '123', name: 'John' };
      mockInternalCache.get.mockResolvedValue(value);

      // When
      const result = await service.get(key);

      // Then
      expect(result).toEqual(value);
      expect(mockInternalCache.get).toHaveBeenCalledWith(key);
    });

    it('should return null when key not found', async () => {
      // Given
      mockInternalCache.get.mockResolvedValue(null);

      // When
      const result = await service.get('nonexistent');

      // Then
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value in cache', async () => {
      // Given
      const key = 'user:123';
      const value = { id: '123', name: 'John' };
      mockInternalCache.set.mockResolvedValue(undefined);

      // When
      await service.set(key, value);

      // Then
      expect(mockInternalCache.set).toHaveBeenCalledWith(key, value, undefined);
    });

    it('should set value with options', async () => {
      // Given
      const key = 'user:123';
      const value = { id: '123', name: 'John' };
      const options = { ttl: 3600, tags: ['users'] };
      mockInternalCache.set.mockResolvedValue(undefined);

      // When
      await service.set(key, value, options);

      // Then
      expect(mockInternalCache.set).toHaveBeenCalledWith(key, value, options);
    });
  });

  describe('del', () => {
    it('should delete key from cache', async () => {
      // Given
      const key = 'user:123';
      mockInternalCache.delete.mockResolvedValue(true);

      // When
      const result = await service.del(key);

      // Then
      expect(result).toBe(true);
      expect(mockInternalCache.delete).toHaveBeenCalledWith(key);
    });

    it('should return false when key not found', async () => {
      // Given
      mockInternalCache.delete.mockResolvedValue(false);

      // When
      const result = await service.del('nonexistent');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('getMany', () => {
    it('should get multiple values', async () => {
      // Given
      const keys = ['user:1', 'user:2', 'user:3'];
      const values = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }, null];
      mockInternalCache.getMany.mockResolvedValue(values);

      // When
      const result = await service.getMany(keys);

      // Then
      expect(result).toEqual(values);
      expect(mockInternalCache.getMany).toHaveBeenCalledWith(keys);
    });
  });

  describe('setMany', () => {
    it('should set multiple values', async () => {
      // Given
      const entries = [
        { key: 'user:1', value: { id: '1' }, ttl: 3600 },
        { key: 'user:2', value: { id: '2' }, ttl: 3600 },
      ];
      mockInternalCache.setMany.mockResolvedValue(undefined);

      // When
      await service.setMany(entries);

      // Then
      expect(mockInternalCache.setMany).toHaveBeenCalledWith(entries);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      // Given
      const key = 'user:123';
      const cachedValue = { id: '123', name: 'John' };
      const loader = vi.fn();
      mockInternalCache.getOrSet.mockResolvedValue(cachedValue);

      // When
      const result = await service.getOrSet(key, loader);

      // Then
      expect(result).toEqual(cachedValue);
      expect(mockInternalCache.getOrSet).toHaveBeenCalledWith(key, loader, undefined);
    });

    it('should call loader when cache miss', async () => {
      // Given
      const key = 'user:123';
      const loadedValue = { id: '123', name: 'John' };
      const loader = vi.fn().mockResolvedValue(loadedValue);
      mockInternalCache.getOrSet.mockImplementation(async (k, l) => l());

      // When
      const result = await service.getOrSet(key, loader);

      // Then
      expect(result).toEqual(loadedValue);
    });

    it('should pass options to internal cache', async () => {
      // Given
      const key = 'user:123';
      const loader = vi.fn();
      const options = { ttl: 3600, tags: ['users'] };
      mockInternalCache.getOrSet.mockResolvedValue({});

      // When
      await service.getOrSet(key, loader, options);

      // Then
      expect(mockInternalCache.getOrSet).toHaveBeenCalledWith(key, loader, options);
    });
  });

  describe('wrap', () => {
    it('should create cached wrapper function', async () => {
      // Given
      const fn = vi.fn().mockResolvedValue({ id: '123', name: 'John' });
      const options = {
        key: (id: string) => `user:${id}`,
        ttl: 3600,
        tags: ['users'],
      };
      mockInternalCache.getOrSet.mockImplementation(async (k, l) => l());

      // When
      const wrapped = service.wrap(fn, options);
      const result = await wrapped('123');

      // Then
      expect(result).toEqual({ id: '123', name: 'John' });
      expect(mockInternalCache.getOrSet).toHaveBeenCalledWith('user:123', expect.any(Function), { ttl: 3600, tags: ['users'] });
    });

    it('should support dynamic tags function', async () => {
      // Given
      const fn = vi.fn().mockResolvedValue({ id: '123' });
      const options = {
        key: (id: string) => `user:${id}`,
        ttl: 3600,
        tags: (id: string) => [`user:${id}`, 'users'],
      };
      mockInternalCache.getOrSet.mockImplementation(async (k, l) => l());

      // When
      const wrapped = service.wrap(fn, options);
      await wrapped('123');

      // Then
      expect(mockInternalCache.getOrSet).toHaveBeenCalledWith('user:123', expect.any(Function), { ttl: 3600, tags: ['user:123', 'users'] });
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple keys from cache', async () => {
      // Given
      const keys = ['user:1', 'user:2', 'user:3'];
      mockInternalCache.deleteMany.mockResolvedValue(3);

      // When
      const count = await service.deleteMany(keys);

      // Then
      expect(count).toBe(3);
      expect(mockInternalCache.deleteMany).toHaveBeenCalledWith(keys);
    });

    it('should return 0 when no keys deleted', async () => {
      // Given
      mockInternalCache.deleteMany.mockResolvedValue(0);

      // When
      const count = await service.deleteMany(['nonexistent']);

      // Then
      expect(count).toBe(0);
    });
  });

  describe('getKeysByTag', () => {
    it('should return keys associated with tag', async () => {
      // Given
      const tag = 'users';
      const keys = ['user:1', 'user:2', 'user:3'];
      mockInternalCache.getKeysByTag.mockResolvedValue(keys);

      // When
      const result = await service.getKeysByTag(tag);

      // Then
      expect(result).toEqual(keys);
      expect(mockInternalCache.getKeysByTag).toHaveBeenCalledWith(tag);
    });

    it('should return empty array when no keys found', async () => {
      // Given
      mockInternalCache.getKeysByTag.mockResolvedValue([]);

      // When
      const result = await service.getKeysByTag('nonexistent');

      // Then
      expect(result).toEqual([]);
    });
  });

  describe('invalidate', () => {
    it('should invalidate cache by tag', async () => {
      // Given
      const tag = 'users';
      mockInternalCache.invalidateTag.mockResolvedValue(5);

      // When
      const count = await service.invalidate(tag);

      // Then
      expect(count).toBe(5);
      expect(mockInternalCache.invalidateTag).toHaveBeenCalledWith(tag);
    });
  });

  describe('invalidateTags', () => {
    it('should invalidate multiple tags', async () => {
      // Given
      const tags = ['users', 'products'];
      mockInternalCache.invalidateTags.mockResolvedValue(10);

      // When
      const count = await service.invalidateTags(tags);

      // Then
      expect(count).toBe(10);
      expect(mockInternalCache.invalidateTags).toHaveBeenCalledWith(tags);
    });
  });

  describe('has', () => {
    it('should check if key exists', async () => {
      // Given
      const key = 'user:123';
      mockInternalCache.has.mockResolvedValue(true);

      // When
      const exists = await service.has(key);

      // Then
      expect(exists).toBe(true);
      expect(mockInternalCache.has).toHaveBeenCalledWith(key);
    });

    it('should return false if key does not exist', async () => {
      // Given
      mockInternalCache.has.mockResolvedValue(false);

      // When
      const exists = await service.has('nonexistent');

      // Then
      expect(exists).toBe(false);
    });
  });

  describe('ttl', () => {
    it('should get TTL for key', async () => {
      // Given
      const key = 'user:123';
      mockInternalCache.ttl.mockResolvedValue(3600);

      // When
      const ttl = await service.ttl(key);

      // Then
      expect(ttl).toBe(3600);
      expect(mockInternalCache.ttl).toHaveBeenCalledWith(key);
    });

    it('should return -2 if key does not exist', async () => {
      // Given
      mockInternalCache.ttl.mockResolvedValue(-2);

      // When
      const ttl = await service.ttl('nonexistent');

      // Then
      expect(ttl).toBe(-2);
    });
  });

  describe('clear', () => {
    it('should clear all cache', async () => {
      // Given
      mockInternalCache.clear.mockResolvedValue(undefined);

      // When
      await service.clear();

      // Then
      expect(mockInternalCache.clear).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should get cache statistics', async () => {
      // Given
      const stats = {
        l1: { hits: 100, misses: 20, size: 50 },
        l2: { hits: 80, misses: 10 },
      };
      mockInternalCache.getStats.mockResolvedValue(stats);

      // When
      const result = await service.getStats();

      // Then
      expect(result).toEqual(stats);
      expect(mockInternalCache.getStats).toHaveBeenCalled();
    });
  });

  describe('invalidateByPattern', () => {
    it('should delegate to internal cache invalidateByPattern', async () => {
      // Given
      const pattern = 'user:*';
      mockInternalCache.invalidateByPattern.mockResolvedValue(5);

      // When
      const count = await service.invalidateByPattern(pattern);

      // Then
      expect(count).toBe(5);
      expect(mockInternalCache.invalidateByPattern).toHaveBeenCalledWith(pattern);
    });

    it('should return 0 when no keys match pattern', async () => {
      // Given
      const pattern = 'nonexistent:*';
      mockInternalCache.invalidateByPattern.mockResolvedValue(0);

      // When
      const count = await service.invalidateByPattern(pattern);

      // Then
      expect(count).toBe(0);
      expect(mockInternalCache.invalidateByPattern).toHaveBeenCalledWith(pattern);
    });

    it('should handle wildcard patterns', async () => {
      // Given
      const pattern = '*:en_US';
      mockInternalCache.invalidateByPattern.mockResolvedValue(3);

      // When
      const count = await service.invalidateByPattern(pattern);

      // Then
      expect(count).toBe(3);
      expect(mockInternalCache.invalidateByPattern).toHaveBeenCalledWith(pattern);
    });
  });
});
