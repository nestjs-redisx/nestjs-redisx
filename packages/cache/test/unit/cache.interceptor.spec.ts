import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';

import { CacheInterceptor } from '../../src/decorators/cache.interceptor';
import { CacheService } from '../../src/cache.service';
import { CACHEABLE_METADATA_KEY } from '../../src/decorators/cacheable.decorator';
import { CACHE_PUT_METADATA_KEY } from '../../src/decorators/cache-put.decorator';
import { CACHE_EVICT_METADATA_KEY } from '../../src/decorators/cache-evict.decorator';

describe('CacheInterceptor', () => {
  let interceptor: CacheInterceptor;
  let mockCacheService: MockedObject<CacheService>;
  let mockReflector: MockedObject<Reflector>;
  let mockContext: MockedObject<ExecutionContext>;
  let mockCallHandler: MockedObject<CallHandler>;

  beforeEach(() => {
    mockCacheService = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      clear: vi.fn(),
      invalidateTags: vi.fn(),
    } as unknown as MockedObject<CacheService>;

    mockReflector = {
      get: vi.fn(),
    } as unknown as MockedObject<Reflector>;

    mockContext = {
      getHandler: vi.fn().mockReturnValue({ name: 'testMethod' }),
      getClass: vi.fn().mockReturnValue({ name: 'TestClass' }),
      getArgs: vi.fn().mockReturnValue([]),
      getArgByIndex: vi.fn().mockImplementation((index: number) => {
        const args = mockContext.getArgs();
        return index < args.length ? args[index] : undefined;
      }),
    } as unknown as MockedObject<ExecutionContext>;

    mockCallHandler = {
      handle: vi.fn().mockReturnValue(of('result')),
    } as unknown as MockedObject<CallHandler>;

    interceptor = new CacheInterceptor(mockCacheService, mockReflector);
  });

  describe('intercept', () => {
    it('should proceed without caching when no decorator metadata found', async () => {
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

  describe('@Cacheable handling', () => {
    it('should return cached value on cache hit', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key' };
        }
        return undefined;
      });
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
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key', ttl: 60 };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should bypass cache when condition returns false', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return {
            key: 'test-key',
            condition: () => false,
          };
        }
        return undefined;
      });

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });

    it('should cache when condition returns true', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return {
            key: 'test-key',
            condition: () => true,
          };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should use custom key generator when provided', async () => {
      // Given
      const keyGenerator = vi.fn().mockReturnValue('custom-key');
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { keyGenerator };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(keyGenerator).toHaveBeenCalled();
      expect(mockCacheService.get).toHaveBeenCalledWith('custom-key');
    });

    it('should propagate cache errors (no graceful handling in pipe)', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key' };
        }
        return undefined;
      });
      mockCacheService.get.mockRejectedValue(new Error('Cache error'));

      // When/Then - error propagates from the Observable
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await expect(firstValueFrom(result$)).rejects.toThrow('Cache error');
    });
  });

  describe('@CachePut handling', () => {
    it('should always execute method and cache result', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_PUT_METADATA_KEY) {
          return { key: 'test-key', ttl: 60 };
        }
        return undefined;
      });
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should skip caching null values when cacheNullValues is false', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_PUT_METADATA_KEY) {
          return { key: 'test-key', cacheNullValues: false };
        }
        return undefined;
      });
      mockCallHandler.handle.mockReturnValue(of(null));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBeNull();
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should bypass cache when condition returns false', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_PUT_METADATA_KEY) {
          return {
            key: 'test-key',
            condition: () => false,
          };
        }
        return undefined;
      });

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('@CacheEvict handling', () => {
    it('should evict cache after method execution by default', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return { keys: ['key1', 'key2'] };
        }
        return undefined;
      });
      mockCacheService.del.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      // Keys are evicted (may be called once per key or combined)
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it('should evict cache before method execution when beforeInvocation is true', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return { keys: ['key1'], beforeInvocation: true };
        }
        return undefined;
      });
      mockCacheService.del.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it('should clear all entries when allEntries is true', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return { allEntries: true };
        }
        return undefined;
      });
      mockCacheService.clear.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.clear).toHaveBeenCalled();
    });

    it('should invalidate tags when provided', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return { tags: ['tag1', 'tag2'] };
        }
        return undefined;
      });
      mockCacheService.invalidateTags.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.invalidateTags).toHaveBeenCalledWith(['tag1', 'tag2']);
    });

    it('should bypass eviction when condition returns false', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return {
            keys: ['key1'],
            condition: () => false,
          };
        }
        return undefined;
      });

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });

  describe('key generation', () => {
    it('should use provided key template', async () => {
      // Given - key template without placeholders works directly
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'user:123:profile' };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.get).toHaveBeenCalledWith('user:123:profile');
    });

    it('should bypass cache when no key template provided (key generation fails)', async () => {
      // Given - no key template means key generation will fail
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return {}; // No key template
        }
        return undefined;
      });

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then - should fall through to method execution due to key generation error
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });

    it('should include namespace in key when provided', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test', namespace: 'myapp' };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.get).toHaveBeenCalledWith('myapp:test');
    });
  });

  describe('tags support', () => {
    it('should resolve tags function and pass to cache set', async () => {
      // Given
      const tagsFn = vi.fn().mockReturnValue(['tag1', 'tag2']);
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key', tags: tagsFn };
        }
        return undefined;
      });
      // The interceptor gets args and passes them to evaluateTags
      mockContext.getArgs.mockReturnValue(['arg1', 'arg2']);
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then - tags function is called (args may vary based on interceptor logic)
      expect(tagsFn).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ tags: ['tag1', 'tag2'] }));
    });

    it('should handle static tags array', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key', tags: ['static-tag1', 'static-tag2'] };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      await firstValueFrom(result$);

      // Then
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', 'result', expect.objectContaining({ tags: ['static-tag1', 'static-tag2'] }));
    });
  });

  describe('error handling', () => {
    it('should handle caching error and still return result', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHEABLE_METADATA_KEY) {
          return { key: 'test-key' };
        }
        return undefined;
      });
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockRejectedValue(new Error('Cache set error'));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });

    it('should handle eviction error gracefully', async () => {
      // Given
      mockReflector.get.mockImplementation((key) => {
        if (key === CACHE_EVICT_METADATA_KEY) {
          return { keys: ['key1'] };
        }
        return undefined;
      });
      mockCacheService.del.mockRejectedValue(new Error('Eviction error'));

      // When
      const result$ = interceptor.intercept(mockContext, mockCallHandler);
      const value = await firstValueFrom(result$);

      // Then
      expect(value).toBe('result');
      expect(mockCallHandler.handle).toHaveBeenCalled();
    });
  });
});
