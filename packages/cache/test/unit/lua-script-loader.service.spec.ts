import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { LuaScriptLoader } from '../../src/tags/infrastructure/services/lua-script-loader.service';
import type { IRedisDriver } from '@nestjs-redisx/core';

describe('LuaScriptLoader', () => {
  let loader: LuaScriptLoader;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    mockDriver = {
      scriptLoad: vi.fn().mockResolvedValue('sha1hash'),
      evalsha: vi.fn().mockResolvedValue(1),
    } as unknown as MockedObject<IRedisDriver>;

    loader = new LuaScriptLoader(mockDriver);
  });

  describe('onModuleInit', () => {
    it('should load all scripts on module initialization', async () => {
      // Given/When
      await loader.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalled();
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.any(String));
    });

    it('should load multiple scripts', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('sha1').mockResolvedValueOnce('sha2');

      // When
      await loader.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledTimes(2);
      expect(loader.isLoaded('invalidate-tag')).toBe(true);
      expect(loader.isLoaded('add-key-to-tags')).toBe(true);
    });

    it('should throw error when script loading fails', async () => {
      // Given
      mockDriver.scriptLoad.mockRejectedValue(new Error('Redis error'));

      // When/Then
      await expect(loader.onModuleInit()).rejects.toThrow();
    });

    it('should store SHA hashes for loaded scripts', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('sha-invalidate').mockResolvedValueOnce('sha-add');

      // When
      await loader.onModuleInit();

      // Then
      expect(loader.getSha('invalidate-tag')).toBe('sha-invalidate');
      expect(loader.getSha('add-key-to-tags')).toBe('sha-add');
    });
  });

  describe('evalSha', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValueOnce('sha-invalidate').mockResolvedValueOnce('sha-add');
      await loader.onModuleInit();
    });

    it('should execute loaded script', async () => {
      // Given
      const scriptName = 'invalidate-tag';
      const keys = ['key1', 'key2'];
      const args = ['arg1', 'arg2'];
      mockDriver.evalsha.mockResolvedValue(5);

      // When
      const result = await loader.evalSha(scriptName, keys, args);

      // Then
      expect(result).toBe(5);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha-invalidate', ['key1', 'key2'], ['arg1', 'arg2']);
    });

    it('should execute script with no keys', async () => {
      // Given
      const scriptName = 'invalidate-tag';
      const keys: string[] = [];
      const args = ['arg1'];
      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const result = await loader.evalSha(scriptName, keys, args);

      // Then
      expect(result).toBe(0);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha-invalidate', [], ['arg1']);
    });

    it('should execute script with no args', async () => {
      // Given
      const scriptName = 'invalidate-tag';
      const keys = ['key1'];
      const args: any[] = [];
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const result = await loader.evalSha(scriptName, keys, args);

      // Then
      expect(result).toBe(1);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha-invalidate', ['key1'], []);
    });

    it('should throw error for unloaded script', async () => {
      // Given
      const scriptName = 'non-existent-script';

      // When/Then
      try {
        await loader.evalSha(scriptName, [], []);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toMatch(/Lua script not loaded/);
      }
    });

    it('should execute different scripts with correct SHAs', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      // When
      const result1 = await loader.evalSha('invalidate-tag', ['k1'], ['a1']);
      const result2 = await loader.evalSha('add-key-to-tags', ['k2'], ['a2']);

      // Then
      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(mockDriver.evalsha).toHaveBeenNthCalledWith(1, 'sha-invalidate', ['k1'], ['a1']);
      expect(mockDriver.evalsha).toHaveBeenNthCalledWith(2, 'sha-add', ['k2'], ['a2']);
    });

    it('should handle script execution errors', async () => {
      // Given
      const scriptName = 'invalidate-tag';
      mockDriver.evalsha.mockRejectedValue(new Error('Script execution failed'));

      // When/Then
      await expect(loader.evalSha(scriptName, [], [])).rejects.toThrow(/Script execution failed/);
    });
  });

  describe('getSha', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValueOnce('sha-invalidate').mockResolvedValueOnce('sha-add');
      await loader.onModuleInit();
    });

    it('should return SHA for loaded script', () => {
      // Given/When
      const sha = loader.getSha('invalidate-tag');

      // Then
      expect(sha).toBe('sha-invalidate');
    });

    it('should return different SHAs for different scripts', () => {
      // Given/When
      const sha1 = loader.getSha('invalidate-tag');
      const sha2 = loader.getSha('add-key-to-tags');

      // Then
      expect(sha1).toBe('sha-invalidate');
      expect(sha2).toBe('sha-add');
      expect(sha1).not.toBe(sha2);
    });

    it('should return undefined for unloaded script', () => {
      // Given/When
      const sha = loader.getSha('non-existent');

      // Then
      expect(sha).toBeUndefined();
    });

    it('should return undefined before initialization', () => {
      // Given
      const uninitializedLoader = new LuaScriptLoader(mockDriver);

      // When
      const sha = uninitializedLoader.getSha('invalidate-tag');

      // Then
      expect(sha).toBeUndefined();
    });
  });

  describe('isLoaded', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValueOnce('sha-invalidate').mockResolvedValueOnce('sha-add');
      await loader.onModuleInit();
    });

    it('should return true for loaded script', () => {
      // Given/When
      const loaded = loader.isLoaded('invalidate-tag');

      // Then
      expect(loaded).toBe(true);
    });

    it('should return true for all loaded scripts', () => {
      // Given/When/Then
      expect(loader.isLoaded('invalidate-tag')).toBe(true);
      expect(loader.isLoaded('add-key-to-tags')).toBe(true);
    });

    it('should return false for unloaded script', () => {
      // Given/When
      const loaded = loader.isLoaded('non-existent');

      // Then
      expect(loaded).toBe(false);
    });

    it('should return false before initialization', () => {
      // Given
      const uninitializedLoader = new LuaScriptLoader(mockDriver);

      // When
      const loaded = uninitializedLoader.isLoaded('invalidate-tag');

      // Then
      expect(loaded).toBe(false);
    });

    it('should be case-sensitive', () => {
      // Given/When/Then
      expect(loader.isLoaded('invalidate-tag')).toBe(true);
      expect(loader.isLoaded('Invalidate-Tag')).toBe(false);
      expect(loader.isLoaded('INVALIDATE-TAG')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle partial load failure', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('sha1').mockRejectedValueOnce(new Error('Second script failed'));

      // When/Then
      await expect(loader.onModuleInit()).rejects.toThrow(/Second script failed/);

      // First script should be loaded
      expect(loader.isLoaded('invalidate-tag')).toBe(true);
    });

    it('should propagate Redis errors', async () => {
      // Given
      mockDriver.scriptLoad.mockRejectedValue(new Error('NOSCRIPT No matching script'));

      // When/Then
      await expect(loader.onModuleInit()).rejects.toThrow(/NOSCRIPT/);
    });
  });
});
