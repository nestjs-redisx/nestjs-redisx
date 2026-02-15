import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CacheInterceptor } from '../../src/decorators/cache.interceptor';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import type { CacheService } from '../../src/cache.service';

describe('CacheInterceptor (decorators)', () => {
  let interceptor: CacheInterceptor;
  let mockCacheService: MockedObject<CacheService>;
  let mockReflector: MockedObject<Reflector>;
  let mockContext: MockedObject<ExecutionContext>;
  let mockCallHandler: MockedObject<CallHandler>;

  beforeEach(() => {
    mockCacheService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
      invalidateTags: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<CacheService>;

    mockReflector = {
      get: vi.fn(),
    } as unknown as MockedObject<Reflector>;

    mockContext = {
      getHandler: vi.fn().mockReturnValue(function testMethod() {}),
      getClass: vi.fn().mockReturnValue(class TestClass {}),
      getArgs: vi.fn().mockReturnValue(['arg1', 'arg2']),
      getArgByIndex: vi.fn((index) => ['arg1', 'arg2'][index]),
    } as unknown as MockedObject<ExecutionContext>;

    mockCallHandler = {
      handle: vi.fn().mockReturnValue(of('result')),
    } as unknown as MockedObject<CallHandler>;

    interceptor = new CacheInterceptor(mockCacheService, mockReflector);
  });

  describe('intercept - no decorators', () => {
    it('should bypass when no cache decorator found', async () => {
      // Given
      mockReflector.get.mockReturnValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(mockCacheService.get).not.toHaveBeenCalled();
    });
  });

  describe('intercept - @Cacheable', () => {
    it('should return cached value on cache hit', async () => {
      // Given
      const options = {
        key: 'test-key',
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue('cached-value');

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('cached-value');
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockCallHandler.handle).not.toHaveBeenCalled();
    });

    it('should execute method and cache result on cache miss', async () => {
      // Given
      const options = {
        key: 'test-key',
        ttl: 3600,
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue(null);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      // Give time for async caching
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ ttl: 3600 }));
    });

    it('should skip caching when condition returns false', async () => {
      // Given
      const options = {
        key: 'test-key',
        condition: () => false,
      };
      mockReflector.get.mockReturnValue(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });

    it('should use custom key generator', async () => {
      // Given
      const options = {
        key: 'fallback',
        keyGenerator: (arg1: string) => `custom:${arg1}`,
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue('cached-value');

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.get).toHaveBeenCalledWith('custom:arg1');
    });

    it('should cache with tags', async () => {
      // Given
      const options = {
        key: 'test-key',
        tags: ['tag1', 'tag2'],
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue(null);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ tags: ['tag1', 'tag2'] }));
    });

    it('should evaluate dynamic tags function', async () => {
      // Given
      const tagsFn = (arg1: string) => [`tag:${arg1}`];
      const options = {
        key: 'test-key',
        tags: tagsFn,
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue(null);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ tags: ['tag:arg1'] }));
    });

    it('should handle caching error gracefully', async () => {
      // Given
      const options = {
        key: 'test-key',
      };
      mockReflector.get.mockReturnValue(options);
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockRejectedValue(new Error('Cache error'));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then - should still return result despite cache error
      expect(value).toBe('result');
    });

    it('should handle key generation error by executing method', async () => {
      // Given
      const options = {
        key: 'invalid:{missing}',
      };
      mockReflector.get.mockReturnValue(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then - should fallback to executing method
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });

  describe('intercept - @CachePut', () => {
    it('should execute method and cache result', async () => {
      // Given
      const options = {
        key: 'test-key',
        ttl: 1800,
      };
      mockReflector.get.mockReturnValueOnce(undefined); // No Cacheable
      mockReflector.get.mockReturnValueOnce(options); // CachePut

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ ttl: 1800 }));
    });

    it('should skip caching when condition returns false', async () => {
      // Given
      const options = {
        key: 'test-key',
        condition: () => false,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should skip caching null value when cacheNullValues is false', async () => {
      // Given
      const options = {
        key: 'test-key',
        cacheNullValues: false,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);
      mockCallHandler.handle.mockReturnValue(of(null));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should cache null value when cacheNullValues is true', async () => {
      // Given
      const options = {
        key: 'test-key',
        cacheNullValues: true,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);
      mockCallHandler.handle.mockReturnValue(of(null));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should skip caching undefined value', async () => {
      // Given
      const options = {
        key: 'test-key',
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);
      mockCallHandler.handle.mockReturnValue(of(undefined));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('intercept - @CacheEvict', () => {
    it('should evict keys after method execution', async () => {
      // Given
      const options = {
        keys: ['key1', 'key2'],
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.del).toHaveBeenCalledWith('key1');
      expect(mockCacheService.del).toHaveBeenCalledWith('key2');
    });

    it('should evict keys before method execution when specified', async () => {
      // Given
      const options = {
        keys: ['key1'],
        beforeInvocation: true,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.del).toHaveBeenCalledWith('key1');
    });

    it('should clear all entries when allEntries is true', async () => {
      // Given
      const options = {
        allEntries: true,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.clear).toHaveBeenCalled();
    });

    it('should invalidate tags', async () => {
      // Given
      const options = {
        tags: ['tag1', 'tag2'],
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.invalidateTags).toHaveBeenCalledWith(['tag1', 'tag2']);
    });

    it('should skip eviction when condition returns false', async () => {
      // Given
      const options = {
        keys: ['key1'],
        condition: () => false,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });

    it('should warn about wildcard keys', async () => {
      // Given
      const options = {
        keys: ['user:*'],
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Should not call del for wildcard keys
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });

    it('should use custom key generator for eviction', async () => {
      // Given
      const keyGenerator = () => ['custom:key1', 'custom:key2'];
      const options = {
        keys: ['template:key'], // Needs non-empty keys for keyGenerator path
        keyGenerator,
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockCacheService.del).toHaveBeenCalledWith('custom:key1');
      expect(mockCacheService.del).toHaveBeenCalledWith('custom:key2');
    });

    it('should handle eviction errors gracefully', async () => {
      // Given
      const options = {
        keys: ['key1'],
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);
      mockCacheService.del.mockRejectedValue(new Error('Eviction error'));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then - should still return result despite eviction error
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });

  describe('intercept - @CachePut error handling', () => {
    it('should handle cache processing errors gracefully', async () => {
      // Given
      const options = {
        key: 'test-key',
      };
      mockReflector.get.mockReturnValueOnce(undefined);
      mockReflector.get.mockReturnValueOnce(options);
      mockCacheService.set.mockRejectedValue(new Error('Cache processing error'));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then - should still return result despite cache error
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });
});
