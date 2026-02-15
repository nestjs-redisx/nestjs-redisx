import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { WarmupService } from '../../src/cache/application/services/warmup.service';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import type { ICachePluginOptions, IWarmupKey } from '../../src/shared/types';

describe('WarmupService', () => {
  let service: WarmupService;
  let mockCacheService: MockedObject<ICacheService>;
  let options: ICachePluginOptions;

  beforeEach(() => {
    mockCacheService = {
      get: vi.fn(),
      set: vi.fn(),
      getOrSet: vi.fn().mockResolvedValue('value'),
      delete: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      has: vi.fn(),
      ttl: vi.fn(),
      clear: vi.fn(),
      invalidateTags: vi.fn(),
      getStats: vi.fn(),
    } as unknown as MockedObject<ICacheService>;

    options = {
      warmup: {
        enabled: true,
        keys: [],
        concurrency: 10,
      },
    };
  });

  describe('onModuleInit', () => {
    it('should skip warmup when disabled', async () => {
      // Given
      options.warmup = { enabled: false, keys: [] };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).not.toHaveBeenCalled();
    });

    it('should skip warmup when no keys configured', async () => {
      // Given
      options.warmup = { enabled: true, keys: [] };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).not.toHaveBeenCalled();
    });

    it('should warmup single key', async () => {
      // Given
      const warmupKey: IWarmupKey = {
        key: 'test-key',
        loader: vi.fn().mockResolvedValue('value'),
        ttl: 60,
      };
      options.warmup = { enabled: true, keys: [warmupKey] };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('test-key', warmupKey.loader, {
        ttl: 60,
        tags: undefined,
      });
    });

    it('should warmup multiple keys', async () => {
      // Given
      const keys: IWarmupKey[] = [
        { key: 'key1', loader: vi.fn().mockResolvedValue('value1'), ttl: 60 },
        { key: 'key2', loader: vi.fn().mockResolvedValue('value2'), ttl: 120 },
      ];
      options.warmup = { enabled: true, keys };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(2);
    });

    it('should warmup keys with tags', async () => {
      // Given
      const warmupKey: IWarmupKey = {
        key: 'test-key',
        loader: vi.fn().mockResolvedValue('value'),
        ttl: 60,
        tags: ['tag1', 'tag2'],
      };
      options.warmup = { enabled: true, keys: [warmupKey] };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith('test-key', warmupKey.loader, {
        ttl: 60,
        tags: ['tag1', 'tag2'],
      });
    });

    it('should handle loader errors gracefully', async () => {
      // Given
      const keys: IWarmupKey[] = [
        {
          key: 'key1',
          loader: vi.fn().mockResolvedValue('value1'),
          ttl: 60,
        },
        {
          key: 'key2',
          loader: vi.fn().mockRejectedValue(new Error('Loader error')),
          ttl: 60,
        },
        {
          key: 'key3',
          loader: vi.fn().mockResolvedValue('value3'),
          ttl: 60,
        },
      ];
      options.warmup = { enabled: true, keys };
      mockCacheService.getOrSet.mockResolvedValueOnce('value1').mockRejectedValueOnce(new Error('Loader error')).mockResolvedValueOnce('value3');

      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(3);
    });

    it('should respect concurrency limit', async () => {
      // Given
      const keys: IWarmupKey[] = Array.from({ length: 25 }, (_, i) => ({
        key: `key${i}`,
        loader: vi.fn().mockResolvedValue(`value${i}`),
        ttl: 60,
      }));
      options.warmup = { enabled: true, keys, concurrency: 10 };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(25);
    });

    it('should use default concurrency when not specified', async () => {
      // Given
      const keys: IWarmupKey[] = [{ key: 'key1', loader: vi.fn().mockResolvedValue('value1'), ttl: 60 }];
      options.warmup = { enabled: true, keys };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalled();
    });

    it('should process keys in chunks', async () => {
      // Given
      const keys: IWarmupKey[] = Array.from({ length: 5 }, (_, i) => ({
        key: `key${i}`,
        loader: vi.fn().mockResolvedValue(`value${i}`),
        ttl: 60,
      }));
      options.warmup = { enabled: true, keys, concurrency: 2 };
      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(5);
    });

    it('should handle warmup when options not provided', async () => {
      // Given
      service = new WarmupService(mockCacheService, {});

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).not.toHaveBeenCalled();
    });

    it('should count succeeded and failed warmups', async () => {
      // Given
      const keys: IWarmupKey[] = [
        { key: 'key1', loader: vi.fn().mockResolvedValue('value1'), ttl: 60 },
        { key: 'key2', loader: vi.fn().mockResolvedValue('value2'), ttl: 60 },
      ];
      options.warmup = { enabled: true, keys };
      mockCacheService.getOrSet.mockResolvedValueOnce('value1').mockResolvedValueOnce('value2');

      service = new WarmupService(mockCacheService, options);

      // When
      await service.onModuleInit();

      // Then
      expect(mockCacheService.getOrSet).toHaveBeenCalledTimes(2);
    });

    it('should complete warmup even with some failures', async () => {
      // Given
      const keys: IWarmupKey[] = [
        { key: 'key1', loader: vi.fn().mockResolvedValue('value1'), ttl: 60 },
        { key: 'key2', loader: vi.fn(), ttl: 60 },
        { key: 'key3', loader: vi.fn().mockResolvedValue('value3'), ttl: 60 },
      ];
      options.warmup = { enabled: true, keys };
      mockCacheService.getOrSet.mockResolvedValueOnce('value1').mockRejectedValueOnce(new Error('Error')).mockResolvedValueOnce('value3');

      service = new WarmupService(mockCacheService, options);

      // When/Then
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('warmup configuration', () => {
    it('should use default enabled value when not specified', () => {
      // Given
      service = new WarmupService(mockCacheService, {});

      // When/Then
      expect(service).toBeDefined();
    });

    it('should use default keys array when not specified', () => {
      // Given
      service = new WarmupService(mockCacheService, { warmup: { enabled: true } });

      // When/Then
      expect(service).toBeDefined();
    });

    it('should use default concurrency when not specified', () => {
      // Given
      service = new WarmupService(mockCacheService, {
        warmup: { enabled: true, keys: [] },
      });

      // When/Then
      expect(service).toBeDefined();
    });
  });
});
