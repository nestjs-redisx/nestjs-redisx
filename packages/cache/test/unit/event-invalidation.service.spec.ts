import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { EventInvalidationService } from '../../src/invalidation/application/services/event-invalidation.service';
import type { IInvalidationRegistry } from '../../src/invalidation/application/ports/invalidation-registry.port';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import type { IRedisDriver } from '@nestjs-redisx/core';
import type { ICachePluginOptions } from '../../src/shared/types';
import type { InvalidationHandler } from '../../src/invalidation/application/ports/event-invalidation.port';

describe('EventInvalidationService', () => {
  let service: EventInvalidationService;
  let mockRegistry: MockedObject<IInvalidationRegistry>;
  let mockCacheService: MockedObject<ICacheService>;
  let mockDriver: MockedObject<IRedisDriver>;
  let options: ICachePluginOptions;

  beforeEach(() => {
    mockRegistry = {
      resolve: vi.fn().mockReturnValue({ tags: [], keys: [] }),
      register: vi.fn(),
      unregister: vi.fn(),
      getAll: vi.fn(),
    } as unknown as MockedObject<IInvalidationRegistry>;

    mockCacheService = {
      invalidateTags: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(),
    } as unknown as MockedObject<ICacheService>;

    mockDriver = {
      exists: vi.fn().mockResolvedValue(0),
      setex: vi.fn().mockResolvedValue('OK'),
    } as unknown as MockedObject<IRedisDriver>;

    options = {
      invalidation: {
        source: 'internal',
        deduplicationTtl: 60,
      },
    };

    service = new EventInvalidationService(mockRegistry, mockCacheService, mockDriver, options);
  });

  describe('onModuleInit', () => {
    it('should setup internal source when configured', async () => {
      // Given
      const service = new EventInvalidationService(mockRegistry, mockCacheService, mockDriver, { invalidation: { source: 'internal' } });

      // When
      await service.onModuleInit();

      // Then - should not throw
      expect(service).toBeDefined();
    });

    it('should use default source when not configured', async () => {
      // Given
      const service = new EventInvalidationService(mockRegistry, mockCacheService, mockDriver, {});

      // When
      await service.onModuleInit();

      // Then - should use internal source by default
      expect(service).toBeDefined();
    });
  });

  describe('processEvent', () => {
    it('should skip duplicate events', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(1); // Event already processed

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('duplicate');
      expect(result.tagsInvalidated).toEqual([]);
      expect(result.keysInvalidated).toEqual([]);
      expect(result.totalKeysDeleted).toBe(0);
      expect(mockRegistry.resolve).not.toHaveBeenCalled();
    });

    it('should skip when no matching rules', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: [], keys: [] });

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('no_matching_rules');
      expect(result.tagsInvalidated).toEqual([]);
      expect(result.keysInvalidated).toEqual([]);
    });

    it('should invalidate tags when rules match', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({
        tags: ['users', 'user:123'],
        keys: [],
      });
      mockCacheService.invalidateTags.mockResolvedValue(5);

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.skipped).toBe(false);
      expect(result.tagsInvalidated).toEqual(['users', 'user:123']);
      expect(result.totalKeysDeleted).toBe(5);
      expect(mockCacheService.invalidateTags).toHaveBeenCalledWith(['users', 'user:123']);
      expect(mockDriver.setex).toHaveBeenCalled(); // Mark as processed
    });

    it('should invalidate keys when rules match', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({
        tags: [],
        keys: ['user:123', 'user:123:profile'],
      });
      mockCacheService.deleteMany.mockResolvedValue(2);

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.skipped).toBe(false);
      expect(result.keysInvalidated).toEqual(['user:123', 'user:123:profile']);
      expect(result.totalKeysDeleted).toBe(2);
      expect(mockCacheService.deleteMany).toHaveBeenCalledWith(['user:123', 'user:123:profile']);
    });

    it('should invalidate both tags and keys', async () => {
      // Given
      const event = 'user.deleted';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({
        tags: ['users'],
        keys: ['user:123'],
      });
      mockCacheService.invalidateTags.mockResolvedValue(3);
      mockCacheService.deleteMany.mockResolvedValue(1);

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.tagsInvalidated).toEqual(['users']);
      expect(result.keysInvalidated).toEqual(['user:123']);
      expect(result.totalKeysDeleted).toBe(4); // 3 + 1
    });

    it('should mark event as processed', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({
        tags: ['users'],
        keys: [],
      });

      // When
      await service.processEvent(event, payload);

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith(expect.stringContaining('_invalidation:processed:'), 60, '1');
    });

    it('should include duration in result', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      const result = await service.processEvent(event, payload);

      // Then
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should notify handlers after processing', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      const handler = vi.fn();
      service.subscribe(handler);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await service.processEvent(event, payload);

      // Then
      expect(handler).toHaveBeenCalledWith(event, payload, expect.any(Object));
    });

    it('should handle errors from invalidation', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });
      mockCacheService.invalidateTags.mockRejectedValue(new Error('Cache error'));

      // When/Then
      await expect(service.processEvent(event, payload)).rejects.toThrow();
    });

    it('should not mark as processed on error', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });
      mockCacheService.invalidateTags.mockRejectedValue(new Error('Cache error'));

      // When/Then
      await expect(service.processEvent(event, payload)).rejects.toThrow();
      expect(mockDriver.setex).not.toHaveBeenCalled();
    });

    it('should continue processing if deduplication check fails', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockRejectedValue(new Error('Redis error'));
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      const result = await service.processEvent(event, payload);

      // Then - should process despite deduplication error
      expect(result.skipped).toBe(false);
    });

    it('should continue if marking as processed fails', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });
      mockDriver.setex.mockRejectedValue(new Error('Redis error'));

      // When
      const result = await service.processEvent(event, payload);

      // Then - should complete successfully
      expect(result.skipped).toBe(false);
    });

    it('should handle handler errors gracefully', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      const faultyHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      service.subscribe(faultyHandler);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      const result = await service.processEvent(event, payload);

      // Then - should complete despite handler error
      expect(result.skipped).toBe(false);
      expect(faultyHandler).toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should emit event to internal source', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await service.emit(event, payload);

      // Give time for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then - processEvent should have been called via event emitter
      expect(mockRegistry.resolve).toHaveBeenCalledWith(event, payload);
    });

    it('should not throw on emit error', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };

      // When/Then - should not throw
      await expect(service.emit(event, payload)).resolves.toBeUndefined();
    });
  });

  describe('subscribe', () => {
    it('should add handler', () => {
      // Given
      const handler: InvalidationHandler = vi.fn();

      // When
      const unsubscribe = service.subscribe(handler);

      // Then
      expect(typeof unsubscribe).toBe('function');
    });

    it('should return unsubscribe function', async () => {
      // Given
      const handler: InvalidationHandler = vi.fn();
      const unsubscribe = service.subscribe(handler);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      unsubscribe();
      await service.processEvent('test', {});

      // Then - handler should not be called after unsubscribe
      expect(handler).not.toHaveBeenCalled();
    });

    it('should call multiple handlers', async () => {
      // Given
      const handler1: InvalidationHandler = vi.fn();
      const handler2: InvalidationHandler = vi.fn();
      service.subscribe(handler1);
      service.subscribe(handler2);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await service.processEvent('test', {});

      // Then
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should pass correct arguments to handler', async () => {
      // Given
      const handler: InvalidationHandler = vi.fn();
      service.subscribe(handler);
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await service.processEvent(event, payload);

      // Then
      expect(handler).toHaveBeenCalledWith(
        event,
        payload,
        expect.objectContaining({
          event,
          tagsInvalidated: ['users'],
        }),
      );
    });
  });

  describe('deduplication', () => {
    it('should generate same event ID for same event and payload', async () => {
      // Given
      const event = 'user.updated';
      const payload = { userId: '123' };
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: [], keys: [] });

      // When
      await service.processEvent(event, payload);
      await service.processEvent(event, payload);

      // Then - both calls should check same event ID
      const calls = mockDriver.exists.mock.calls;
      expect(calls[0][0]).toBe(calls[1][0]);
    });

    it('should generate different event IDs for different payloads', async () => {
      // Given
      const event = 'user.updated';
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: [], keys: [] });

      // When
      await service.processEvent(event, { userId: '123' });
      await service.processEvent(event, { userId: '456' });

      // Then
      const calls = mockDriver.exists.mock.calls;
      expect(calls[0][0]).not.toBe(calls[1][0]);
    });

    it('should use configured deduplication TTL', async () => {
      // Given
      const customOptions: ICachePluginOptions = {
        invalidation: { source: 'internal', deduplicationTtl: 120 },
      };
      const customService = new EventInvalidationService(mockRegistry, mockCacheService, mockDriver, customOptions);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await customService.processEvent('test', {});

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith(expect.any(String), 120, '1');
    });

    it('should use default TTL when not configured', async () => {
      // Given
      const customOptions: ICachePluginOptions = {};
      const customService = new EventInvalidationService(mockRegistry, mockCacheService, mockDriver, customOptions);
      mockDriver.exists.mockResolvedValue(0);
      mockRegistry.resolve.mockReturnValue({ tags: ['users'], keys: [] });

      // When
      await customService.processEvent('test', {});

      // Then
      expect(mockDriver.setex).toHaveBeenCalledWith(expect.any(String), 60, '1');
    });
  });
});
