import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cached, registerCacheServiceGetter, registerCachePluginOptions, type ICachedOptions } from '../../src/cache/api/decorators/cached.decorator';
import { CACHE_OPTIONS_KEY } from '../../src/shared/constants';

describe('@Cached decorator', () => {
  class TestClass {
    @Cached()
    async defaultMethod(): Promise<string> {
      return 'result';
    }

    @Cached({ ttl: 60 })
    async methodWithTtl(): Promise<string> {
      return 'result';
    }

    @Cached({ key: 'custom:key' })
    async methodWithCustomKey(): Promise<string> {
      return 'result';
    }

    @Cached({ tags: ['tag1', 'tag2'] })
    async methodWithTags(): Promise<string> {
      return 'result';
    }

    @Cached({ strategy: 'l1-only' })
    async methodWithStrategy(): Promise<string> {
      return 'result';
    }

    @Cached({ condition: () => true })
    async methodWithCondition(): Promise<string> {
      return 'result';
    }

    @Cached({ unless: () => false })
    async methodWithUnless(): Promise<string> {
      return 'result';
    }

    @Cached({ varyBy: ['x-tenant-id'] })
    async methodWithVaryBy(): Promise<string> {
      return 'result';
    }

    @Cached({ swr: { enabled: true, staleTime: 30 } })
    async methodWithSwr(): Promise<string> {
      return 'result';
    }

    @Cached({
      key: 'user:{0}',
      ttl: 3600,
      tags: ['users'],
      strategy: 'l1-l2',
    })
    async complexMethod(id: string): Promise<string> {
      return `User ${id}`;
    }
  }

  describe('decorator metadata', () => {
    it('should set metadata for default options', () => {
      // Given
      const target = new TestClass();
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'defaultMethod');

      // When
      const metadata = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
    });

    it('should set metadata with ttl option', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithTtl');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.ttl).toBe(60);
    });

    it('should set metadata with custom key', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithCustomKey');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.key).toBe('custom:key');
    });

    it('should set metadata with tags', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithTags');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.tags).toEqual(['tag1', 'tag2']);
    });

    it('should set metadata with strategy', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithStrategy');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.strategy).toBe('l1-only');
    });

    it('should set metadata with condition', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithCondition');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(typeof metadata.condition).toBe('function');
    });

    it('should set metadata with unless', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithUnless');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(typeof metadata.unless).toBe('function');
    });

    it('should set metadata with varyBy', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithVaryBy');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.varyBy).toEqual(['x-tenant-id']);
    });

    it('should set metadata with swr', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithSwr');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.swr).toEqual({ enabled: true, staleTime: 30 });
    });

    it('should set metadata with complex options', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'complexMethod');

      // When
      const metadata: ICachedOptions = Reflect.getMetadata(CACHE_OPTIONS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.key).toBe('user:{0}');
      expect(metadata.ttl).toBe(3600);
      expect(metadata.tags).toEqual(['users']);
      expect(metadata.strategy).toBe('l1-l2');
    });
  });

  describe('decorator application', () => {
    it('should not modify method functionality', async () => {
      // Given
      const instance = new TestClass();

      // When
      const result = await instance.defaultMethod();

      // Then
      expect(result).toBe('result');
    });

    it('should preserve method signature', async () => {
      // Given
      const instance = new TestClass();

      // When
      const result = await instance.complexMethod('123');

      // Then
      expect(result).toBe('User 123');
    });
  });

  describe('context enrichment', () => {
    let mockCacheService: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      getOrSet: ReturnType<typeof vi.fn>;
      invalidateTags: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockCacheService = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        getOrSet: vi.fn().mockImplementation(async (_key: string, loader: () => Promise<unknown>, _opts?: unknown) => {
          return loader();
        }),
        invalidateTags: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn().mockResolvedValue(0),
      };
      registerCacheServiceGetter(() => mockCacheService);
    });

    afterEach(() => {
      // Reset global state
      registerCacheServiceGetter(null as unknown as () => typeof mockCacheService);
      registerCachePluginOptions(null as unknown as { contextProvider?: unknown });
    });

    it('should pass plain key when no contextProvider configured', async () => {
      // Given
      registerCachePluginOptions({});

      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42', expect.any(Function), expect.any(Object));
    });

    it('should enrich key with global contextKeys', async () => {
      // Given
      const contextStore = new Map([['tenantId', 'acme']]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
      });

      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42:_ctx_:tenantId.acme', expect.any(Function), expect.any(Object));
    });

    it('should enrich key with varyBy resolved from contextProvider', async () => {
      // Given
      const contextStore = new Map([
        ['tenantId', 'acme'],
        ['locale', 'en'],
      ]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
      });

      class Svc {
        @Cached({ key: 'products', varyBy: ['locale'] })
        async getProducts() {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.getProducts();

      // Then — both global contextKeys + varyBy, sorted alphabetically
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('products:_ctx_:locale.en:tenantId.acme', expect.any(Function), expect.any(Object));
    });

    it('should override global contextKeys with per-decorator contextKeys', async () => {
      // Given
      const contextStore = new Map([
        ['tenantId', 'acme'],
        ['locale', 'en'],
        ['region', 'us'],
      ]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId', 'region'], // global
      });

      class Svc {
        @Cached({ key: 'data', contextKeys: ['locale'] }) // override: only locale
        async getData() {
          return {};
        }
      }

      // When
      const svc = new Svc();
      await svc.getData();

      // Then — only per-decorator contextKeys used, not global
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('data:_ctx_:locale.en', expect.any(Function), expect.any(Object));
    });

    it('should skip context enrichment when skipContext is true', async () => {
      // Given
      const contextStore = new Map([['tenantId', 'acme']]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
      });

      class Svc {
        @Cached({ key: 'config:app', skipContext: true })
        async getConfig() {
          return {};
        }
      }

      // When
      const svc = new Svc();
      await svc.getConfig();

      // Then — no context suffix
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('config:app', expect.any(Function), expect.any(Object));
    });

    it('should use enriched key in getOrSet call', async () => {
      // Given
      const contextStore = new Map([['tenantId', 'acme']]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
      });

      class Svc {
        @Cached({ key: 'user:{0}', ttl: 60 })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then — single getOrSet call with enriched key
      const expectedKey = 'user:42:_ctx_:tenantId.acme';
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith(expectedKey, expect.any(Function), expect.objectContaining({ ttl: 60 }));
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should ignore varyBy keys not found in contextProvider', async () => {
      // Given
      const contextStore = new Map([['tenantId', 'acme']]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
      });

      class Svc {
        @Cached({ key: 'data', varyBy: ['missing-key'] })
        async getData() {
          return {};
        }
      }

      // When
      const svc = new Svc();
      await svc.getData();

      // Then — only tenantId present, missing-key ignored
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('data:_ctx_:tenantId.acme', expect.any(Function), expect.any(Object));
    });

    it('should use custom separator from plugin options', async () => {
      // Given
      const contextStore = new Map([['tenantId', 'acme']]);
      registerCachePluginOptions({
        contextProvider: { get: (k: string) => contextStore.get(k) },
        contextKeys: ['tenantId'],
        keys: { separator: '::' },
      });

      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then — uses :: separator for _ctx_ marker
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42::_ctx_::tenantId.acme', expect.any(Function), expect.any(Object));
    });
  });

  describe('stampede protection via getOrSet', () => {
    let mockCacheService: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      getOrSet: ReturnType<typeof vi.fn>;
      invalidateTags: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockCacheService = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        getOrSet: vi.fn().mockImplementation(async (_key: string, loader: () => Promise<unknown>, _opts?: unknown) => {
          return loader();
        }),
        invalidateTags: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn().mockResolvedValue(0),
      };
      registerCacheServiceGetter(() => mockCacheService);
      registerCachePluginOptions({});
    });

    afterEach(() => {
      registerCacheServiceGetter(null as unknown as () => typeof mockCacheService);
      registerCachePluginOptions(null as unknown as { contextProvider?: unknown });
    });

    it('should use getOrSet for stampede protection', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(1);
      expect(mockCacheService.get).not.toHaveBeenCalled();
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should pass unless option to getOrSet', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}', unless: (result) => result === null })
        async getUser(id: string) {
          return null;
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42', expect.any(Function), expect.objectContaining({ unless: expect.any(Function) }));
    });

    it('should adapt unless signature (result, ...args) to (result)', async () => {
      // Given
      const unlessFn = vi.fn().mockReturnValue(false);

      class Svc {
        @Cached({ key: 'user:{0}', unless: unlessFn })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then — the unless passed to getOrSet should be an adapter
      const getOrSetCall = mockCacheService.getOrSet.mock.calls[0];
      const adaptedUnless = getOrSetCall[2].unless;
      expect(adaptedUnless).toBeDefined();

      // Call the adapter to verify it passes args through
      adaptedUnless({ id: '42' });
      expect(unlessFn).toHaveBeenCalledWith({ id: '42' }, '42');
    });

    it('should bypass cache when condition returns false', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}', condition: () => false })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      const result = await svc.getUser('42');

      // Then
      expect(result).toEqual({ id: '42' });
      expect(mockCacheService.getOrSet).not.toHaveBeenCalled();
    });

    it('should fall back to original method when getOrSet throws', async () => {
      // Given
      mockCacheService.getOrSet.mockRejectedValue(new Error('Redis down'));

      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      const result = await svc.getUser('42');

      // Then
      expect(result).toEqual({ id: '42' });
    });

    it('should pass swr options to getOrSet', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}', swr: { enabled: true, staleTime: 30 } })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42', expect.any(Function), expect.objectContaining({ swr: { enabled: true, staleTime: 30 } }));
    });

    it('should pass tags to getOrSet options', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}', tags: ['users'] })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42', expect.any(Function), expect.objectContaining({ tags: ['users'] }));
    });

    it('should resolve dynamic tags before passing to getOrSet', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}', tags: (id: string) => [`user:${id}`, 'users'] })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('user:42', expect.any(Function), expect.objectContaining({ tags: ['user:42', 'users'] }));
    });

    it('should produce deterministic keys for object args regardless of key order', async () => {
      // Given
      class Svc {
        @Cached()
        async find(filter: Record<string, unknown>) {
          return [];
        }
      }

      // When — call with same data, different key order
      const svc = new Svc();
      await svc.find({ b: 2, a: 1 });
      const key1 = mockCacheService.getOrSet.mock.calls[0][0];

      mockCacheService.getOrSet.mockClear();
      await svc.find({ a: 1, b: 2 });
      const key2 = mockCacheService.getOrSet.mock.calls[0][0];

      // Then — both produce the same cache key
      expect(key1).toBe(key2);
    });

    it('should produce deterministic keys for nested objects', async () => {
      // Given
      class Svc {
        @Cached()
        async find(filter: Record<string, unknown>) {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.find({ z: { b: 2, a: 1 }, a: 'x' });
      const key1 = mockCacheService.getOrSet.mock.calls[0][0];

      mockCacheService.getOrSet.mockClear();
      await svc.find({ a: 'x', z: { a: 1, b: 2 } });
      const key2 = mockCacheService.getOrSet.mock.calls[0][0];

      // Then
      expect(key1).toBe(key2);
    });

    it('should produce deterministic keys for object args in key templates', async () => {
      // Given
      class Svc {
        @Cached({ key: 'items:{0}' })
        async find(filter: Record<string, unknown>) {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.find({ status: 'active', role: 'admin' });
      const key1 = mockCacheService.getOrSet.mock.calls[0][0];

      mockCacheService.getOrSet.mockClear();
      await svc.find({ role: 'admin', status: 'active' });
      const key2 = mockCacheService.getOrSet.mock.calls[0][0];

      // Then
      expect(key1).toBe(key2);
      expect(key1).toBe('items:{"role":"admin","status":"active"}');
    });

    it('should skip undefined values in objects (matches JSON.stringify)', async () => {
      // Given
      class Svc {
        @Cached({ key: 'items:{0}' })
        async find(filter: Record<string, unknown>) {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.find({ a: 1, b: undefined, c: 3 });
      const key1 = mockCacheService.getOrSet.mock.calls[0][0];

      mockCacheService.getOrSet.mockClear();
      await svc.find({ a: 1, c: 3 });
      const key2 = mockCacheService.getOrSet.mock.calls[0][0];

      // Then -- undefined keys are skipped, same as JSON.stringify
      expect(key1).toBe(key2);
    });

    it('should serialize undefined in arrays as null (matches JSON.stringify)', async () => {
      // Given
      class Svc {
        @Cached({ key: 'items:{0}' })
        async find(filter: unknown[]) {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.find([1, undefined, 3]);
      const key = mockCacheService.getOrSet.mock.calls[0][0];

      // Then -- undefined becomes null in arrays, same as JSON.stringify
      expect(key).toBe('items:[1,null,3]');
    });

    it('should handle arrays in object args deterministically', async () => {
      // Given
      class Svc {
        @Cached()
        async find(filter: Record<string, unknown>) {
          return [];
        }
      }

      // When
      const svc = new Svc();
      await svc.find({ ids: [3, 1, 2], active: true });
      const key1 = mockCacheService.getOrSet.mock.calls[0][0];

      mockCacheService.getOrSet.mockClear();
      await svc.find({ active: true, ids: [3, 1, 2] });
      const key2 = mockCacheService.getOrSet.mock.calls[0][0];

      // Then — same key (keys sorted, array order preserved)
      expect(key1).toBe(key2);
    });

    it('should not pass unless to getOrSet when not configured', async () => {
      // Given
      class Svc {
        @Cached({ key: 'user:{0}' })
        async getUser(id: string) {
          return { id };
        }
      }

      // When
      const svc = new Svc();
      await svc.getUser('42');

      // Then
      const getOrSetCall = mockCacheService.getOrSet.mock.calls[0];
      expect(getOrSetCall[2].unless).toBeUndefined();
    });
  });
});
