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
        getOrSet: vi.fn().mockResolvedValue(null),
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
      expect(mockCacheService.get).toHaveBeenCalledWith('user:42');
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
      expect(mockCacheService.get).toHaveBeenCalledWith('user:42:_ctx_:tenantId.acme');
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
      expect(mockCacheService.get).toHaveBeenCalledWith('products:_ctx_:locale.en:tenantId.acme');
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
      expect(mockCacheService.get).toHaveBeenCalledWith('data:_ctx_:locale.en');
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
      expect(mockCacheService.get).toHaveBeenCalledWith('config:app');
    });

    it('should use same enriched key for both get and set', async () => {
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

      // Then
      const expectedKey = 'user:42:_ctx_:tenantId.acme';
      expect(mockCacheService.get).toHaveBeenCalledWith(expectedKey);
      expect(mockCacheService.set).toHaveBeenCalledWith(expectedKey, { id: '42' }, expect.objectContaining({ ttl: 60 }));
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
      expect(mockCacheService.get).toHaveBeenCalledWith('data:_ctx_:tenantId.acme');
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
      expect(mockCacheService.get).toHaveBeenCalledWith('user:42::_ctx_::tenantId.acme');
    });
  });
});
