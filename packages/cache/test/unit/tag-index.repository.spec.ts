import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { TagIndexRepository } from '../../src/tags/infrastructure/repositories/tag-index.repository';
import type { IRedisDriver } from '@nestjs-redisx/core';
import type { ICachePluginOptions } from '../../src/shared/types';
import type { LuaScriptLoader } from '../../src/tags/infrastructure/services/lua-script-loader.service';

describe('TagIndexRepository', () => {
  let repository: TagIndexRepository;
  let mockDriver: MockedObject<IRedisDriver>;
  let mockLuaLoader: MockedObject<LuaScriptLoader>;
  let options: ICachePluginOptions;

  beforeEach(() => {
    mockDriver = {
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      scard: vi.fn().mockResolvedValue(0),
      del: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      scan: vi.fn().mockResolvedValue(['0', []]),
    } as unknown as MockedObject<IRedisDriver>;

    mockLuaLoader = {
      load: vi.fn(),
      getScriptSha: vi.fn(),
    } as unknown as MockedObject<LuaScriptLoader>;

    options = {
      l2: { keyPrefix: 'cache:' },
      tags: { indexPrefix: '_tag:', ttl: 604800, maxTagsPerKey: 10 },
    };

    repository = new TagIndexRepository(mockDriver, options, mockLuaLoader);
  });

  describe('addKeyToTags', () => {
    it('should add key to multiple tags', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users', 'premium'];

      // When
      await repository.addKeyToTags(key, tags);

      // Then
      expect(mockDriver.sadd).toHaveBeenCalledTimes(2);
      expect(mockDriver.sadd).toHaveBeenCalledWith('cache:_tag:users', key);
      expect(mockDriver.sadd).toHaveBeenCalledWith('cache:_tag:premium', key);
      expect(mockDriver.expire).toHaveBeenCalledTimes(2);
      expect(mockDriver.expire).toHaveBeenCalledWith('cache:_tag:users', 604800);
      expect(mockDriver.expire).toHaveBeenCalledWith('cache:_tag:premium', 604800);
    });

    it('should handle empty tags array', async () => {
      // Given
      const key = 'user:123';
      const tags: string[] = [];

      // When
      await repository.addKeyToTags(key, tags);

      // Then
      expect(mockDriver.sadd).not.toHaveBeenCalled();
      expect(mockDriver.expire).not.toHaveBeenCalled();
    });

    it('should add key to single tag', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users'];

      // When
      await repository.addKeyToTags(key, tags);

      // Then
      expect(mockDriver.sadd).toHaveBeenCalledTimes(1);
      expect(mockDriver.sadd).toHaveBeenCalledWith('cache:_tag:users', key);
      expect(mockDriver.expire).toHaveBeenCalledTimes(1);
    });

    it('should use configured tag prefix', async () => {
      // Given
      const customOptions: ICachePluginOptions = {
        l2: { keyPrefix: 'myapp:' },
        tags: { indexPrefix: 'tags:', ttl: 3600 },
      };
      const customRepo = new TagIndexRepository(mockDriver, customOptions, mockLuaLoader);
      const key = 'user:123';
      const tags = ['users'];

      // When
      await customRepo.addKeyToTags(key, tags);

      // Then
      expect(mockDriver.sadd).toHaveBeenCalledWith('myapp:tags:users', key);
    });

    it('should use configured tag TTL', async () => {
      // Given
      const customOptions: ICachePluginOptions = {
        l2: { keyPrefix: 'cache:' },
        tags: { indexPrefix: '_tag:', ttl: 3600 },
      };
      const customRepo = new TagIndexRepository(mockDriver, customOptions, mockLuaLoader);
      const key = 'user:123';
      const tags = ['users'];

      // When
      await customRepo.addKeyToTags(key, tags);

      // Then
      expect(mockDriver.expire).toHaveBeenCalledWith('cache:_tag:users', 3600);
    });

    it('should throw TagInvalidationError on Redis failure', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users'];
      mockDriver.sadd.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.addKeyToTags(key, tags);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('removeKeyFromTags', () => {
    it('should remove key from multiple tags', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users', 'premium'];

      // When
      await repository.removeKeyFromTags(key, tags);

      // Then
      expect(mockDriver.srem).toHaveBeenCalledTimes(2);
      expect(mockDriver.srem).toHaveBeenCalledWith('cache:_tag:users', key);
      expect(mockDriver.srem).toHaveBeenCalledWith('cache:_tag:premium', key);
    });

    it('should handle empty tags array', async () => {
      // Given
      const key = 'user:123';
      const tags: string[] = [];

      // When
      await repository.removeKeyFromTags(key, tags);

      // Then
      expect(mockDriver.srem).not.toHaveBeenCalled();
    });

    it('should remove key from single tag', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users'];

      // When
      await repository.removeKeyFromTags(key, tags);

      // Then
      expect(mockDriver.srem).toHaveBeenCalledTimes(1);
      expect(mockDriver.srem).toHaveBeenCalledWith('cache:_tag:users', key);
    });

    it('should throw TagInvalidationError on Redis failure', async () => {
      // Given
      const key = 'user:123';
      const tags = ['users'];
      mockDriver.srem.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.removeKeyFromTags(key, tags);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('getKeysByTag', () => {
    it('should return keys for tag', async () => {
      // Given
      const tag = 'users';
      const keys = ['user:1', 'user:2', 'user:3'];
      mockDriver.smembers.mockResolvedValue(keys);

      // When
      const result = await repository.getKeysByTag(tag);

      // Then
      expect(result).toEqual(keys);
      expect(mockDriver.smembers).toHaveBeenCalledWith('cache:_tag:users');
    });

    it('should return empty array when tag has no keys', async () => {
      // Given
      const tag = 'users';
      mockDriver.smembers.mockResolvedValue([]);

      // When
      const result = await repository.getKeysByTag(tag);

      // Then
      expect(result).toEqual([]);
      expect(mockDriver.smembers).toHaveBeenCalledWith('cache:_tag:users');
    });

    it('should throw TagInvalidationError on Redis failure', async () => {
      // Given
      const tag = 'users';
      mockDriver.smembers.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.getKeysByTag(tag);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('invalidateTag', () => {
    it('should delete all keys for tag', async () => {
      // Given
      const tag = 'users';
      const keys = ['user:1', 'user:2', 'user:3'];
      mockDriver.smembers.mockResolvedValue(keys);
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await repository.invalidateTag(tag);

      // Then
      expect(result).toBe(3);
      expect(mockDriver.smembers).toHaveBeenCalledWith('cache:_tag:users');
      expect(mockDriver.del).toHaveBeenCalledTimes(4); // 3 cache keys + 1 tag set
      expect(mockDriver.del).toHaveBeenCalledWith('user:1');
      expect(mockDriver.del).toHaveBeenCalledWith('user:2');
      expect(mockDriver.del).toHaveBeenCalledWith('user:3');
      expect(mockDriver.del).toHaveBeenCalledWith('cache:_tag:users');
    });

    it('should return 0 when tag has no keys', async () => {
      // Given
      const tag = 'users';
      mockDriver.smembers.mockResolvedValue([]);

      // When
      const result = await repository.invalidateTag(tag);

      // Then
      expect(result).toBe(0);
      expect(mockDriver.del).toHaveBeenCalledWith('cache:_tag:users');
    });

    it('should handle large batch of keys', async () => {
      // Given
      const tag = 'users';
      const keys = Array.from({ length: 250 }, (_, i) => `user:${i}`);
      mockDriver.smembers.mockResolvedValue(keys);
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await repository.invalidateTag(tag);

      // Then
      expect(result).toBe(250);
      // 250 cache keys + 1 tag set = 251 del calls
      expect(mockDriver.del).toHaveBeenCalledTimes(251);
    });

    it('should delete tag set after deleting keys', async () => {
      // Given
      const tag = 'users';
      const keys = ['user:1'];
      mockDriver.smembers.mockResolvedValue(keys);

      // When
      await repository.invalidateTag(tag);

      // Then
      const delCalls = mockDriver.del.mock.calls;
      const lastCall = delCalls[delCalls.length - 1];
      expect(lastCall[0]).toBe('cache:_tag:users');
    });

    it('should throw TagInvalidationError on Redis failure', async () => {
      // Given
      const tag = 'users';
      mockDriver.smembers.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.invalidateTag(tag);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('invalidateTags', () => {
    it('should invalidate multiple tags', async () => {
      // Given
      const tags = ['users', 'premium'];
      mockDriver.smembers.mockResolvedValueOnce(['user:1', 'user:2']);
      mockDriver.smembers.mockResolvedValueOnce(['user:3']);
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await repository.invalidateTags(tags);

      // Then
      expect(result).toBe(3);
      expect(mockDriver.smembers).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for empty tags array', async () => {
      // Given
      const tags: string[] = [];

      // When
      const result = await repository.invalidateTags(tags);

      // Then
      expect(result).toBe(0);
      expect(mockDriver.smembers).not.toHaveBeenCalled();
    });

    it('should sum invalidated keys across tags', async () => {
      // Given
      const tags = ['tag1', 'tag2', 'tag3'];
      mockDriver.smembers.mockResolvedValueOnce(['key:1', 'key:2']);
      mockDriver.smembers.mockResolvedValueOnce(['key:3']);
      mockDriver.smembers.mockResolvedValueOnce(['key:4', 'key:5', 'key:6']);
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await repository.invalidateTags(tags);

      // Then
      expect(result).toBe(6);
    });

    it('should throw TagInvalidationError on failure', async () => {
      // Given
      const tags = ['users'];
      mockDriver.smembers.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.invalidateTags(tags);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('clearAllTags', () => {
    it('should delete all tag keys', async () => {
      // Given
      mockDriver.scan.mockResolvedValueOnce(['10', ['cache:_tag:users', 'cache:_tag:premium']]);
      mockDriver.scan.mockResolvedValueOnce(['0', ['cache:_tag:active']]);

      // When
      await repository.clearAllTags();

      // Then
      expect(mockDriver.scan).toHaveBeenCalledWith(0, {
        match: 'cache:_tag:*',
        count: 100,
      });
      expect(mockDriver.del).toHaveBeenCalledTimes(3);
      expect(mockDriver.del).toHaveBeenCalledWith('cache:_tag:users');
      expect(mockDriver.del).toHaveBeenCalledWith('cache:_tag:premium');
      expect(mockDriver.del).toHaveBeenCalledWith('cache:_tag:active');
    });

    it('should handle no tags', async () => {
      // Given
      mockDriver.scan.mockResolvedValue(['0', []]);

      // When
      await repository.clearAllTags();

      // Then
      expect(mockDriver.del).not.toHaveBeenCalled();
    });

    it('should scan all keys using cursor', async () => {
      // Given
      mockDriver.scan.mockResolvedValueOnce(['50', ['tag:1']]);
      mockDriver.scan.mockResolvedValueOnce(['100', ['tag:2']]);
      mockDriver.scan.mockResolvedValueOnce(['0', ['tag:3']]);

      // When
      await repository.clearAllTags();

      // Then
      expect(mockDriver.scan).toHaveBeenCalledTimes(3);
    });

    it('should handle large batch of tags', async () => {
      // Given
      const tags = Array.from({ length: 250 }, (_, i) => `cache:_tag:tag${i}`);
      mockDriver.scan.mockResolvedValue(['0', tags]);

      // When
      await repository.clearAllTags();

      // Then
      expect(mockDriver.del).toHaveBeenCalledTimes(250);
    });

    it('should throw TagInvalidationError on scan failure', async () => {
      // Given
      mockDriver.scan.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await repository.clearAllTags();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/TagInvalidationError/);
      }
    });
  });

  describe('getTagStats', () => {
    it('should return stats for existing tag', async () => {
      // Given
      const tag = 'users';
      mockDriver.exists.mockResolvedValue(1);
      mockDriver.scard.mockResolvedValue(42);

      // When
      const result = await repository.getTagStats(tag);

      // Then
      expect(result).toEqual({ keyCount: 42, exists: true });
      expect(mockDriver.exists).toHaveBeenCalledWith('cache:_tag:users');
      expect(mockDriver.scard).toHaveBeenCalledWith('cache:_tag:users');
    });

    it('should return zero stats for non-existent tag', async () => {
      // Given
      const tag = 'users';
      mockDriver.exists.mockResolvedValue(0);

      // When
      const result = await repository.getTagStats(tag);

      // Then
      expect(result).toEqual({ keyCount: 0, exists: false });
      expect(mockDriver.exists).toHaveBeenCalledWith('cache:_tag:users');
      expect(mockDriver.scard).not.toHaveBeenCalled();
    });

    it('should return safe defaults on error', async () => {
      // Given
      const tag = 'users';
      mockDriver.exists.mockRejectedValue(new Error('Redis error'));

      // When
      const result = await repository.getTagStats(tag);

      // Then
      expect(result).toEqual({ keyCount: 0, exists: false });
    });
  });

  describe('default configuration', () => {
    it('should use default tag prefix when not configured', () => {
      // Given
      const minimalOptions: ICachePluginOptions = {};
      const repo = new TagIndexRepository(mockDriver, minimalOptions, mockLuaLoader);

      // When/Then
      // Constructor should not throw
      expect(repo).toBeDefined();
    });

    it('should use default L2 prefix when not configured', () => {
      // Given
      const minimalOptions: ICachePluginOptions = {
        tags: { indexPrefix: 'tag:' },
      };
      const repo = new TagIndexRepository(mockDriver, minimalOptions, mockLuaLoader);

      // When
      repo.addKeyToTags('key', ['test']);

      // Then
      expect(mockDriver.sadd).toHaveBeenCalledWith('cache:tag:test', 'key');
    });
  });
});
