import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwrManagerService } from '../../src/swr/infrastructure/swr-manager.service';
import type { ICachePluginOptions, SwrEntry } from '../../src/shared/types';

describe('SwrManagerService', () => {
  let service: SwrManagerService;
  let options: ICachePluginOptions;

  beforeEach(() => {
    options = {
      swr: {
        enabled: true,
        defaultStaleTime: 300,
      },
    };
    service = new SwrManagerService(options);
  });

  describe('constructor', () => {
    it('should initialize with enabled SWR', () => {
      // Given/When
      const service = new SwrManagerService({ swr: { enabled: true } });

      // Then
      const stats = service.getStats();
      expect(stats.enabled).toBe(true);
    });

    it('should initialize with disabled SWR by default', () => {
      // Given/When
      const service = new SwrManagerService({});

      // Then
      const stats = service.getStats();
      expect(stats.enabled).toBe(false);
    });

    it('should use default staleTtl when not configured', () => {
      // Given/When
      const service = new SwrManagerService({ swr: { enabled: true } });

      // Then
      const stats = service.getStats();
      expect(stats.staleTtl).toBe(60);
    });

    it('should use configured defaultStaleTime', () => {
      // Given/When
      const service = new SwrManagerService({
        swr: { enabled: true, defaultStaleTime: 600 },
      });

      // Then
      const stats = service.getStats();
      expect(stats.staleTtl).toBe(600);
    });
  });

  describe('isStale', () => {
    it('should return false when SWR is disabled', () => {
      // Given
      const disabledService = new SwrManagerService({ swr: { enabled: false } });
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: Date.now() - 10000,
        staleAt: Date.now() - 5000,
        expiresAt: Date.now() + 5000,
      };

      // When
      const result = disabledService.isStale(entry);

      // Then
      expect(result).toBe(false);
    });

    it('should return true when entry is stale', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now - 10000,
        staleAt: now - 1000, // Stale 1 second ago
        expiresAt: now + 5000,
      };

      // When
      const result = service.isStale(entry);

      // Then
      expect(result).toBe(true);
    });

    it('should return false when entry is fresh', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now,
        staleAt: now + 5000, // Fresh for 5 more seconds
        expiresAt: now + 10000,
      };

      // When
      const result = service.isStale(entry);

      // Then
      expect(result).toBe(false);
    });

    it('should return false when entry is exactly at stale time', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now - 5000,
        staleAt: now,
        expiresAt: now + 5000,
      };

      // When
      const result = service.isStale(entry);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return true when entry is expired', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now - 10000,
        staleAt: now - 5000,
        expiresAt: now - 1000, // Expired 1 second ago
      };

      // When
      const result = service.isExpired(entry);

      // Then
      expect(result).toBe(true);
    });

    it('should return false when entry is not expired', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now,
        staleAt: now + 5000,
        expiresAt: now + 10000, // Expires in 10 seconds
      };

      // When
      const result = service.isExpired(entry);

      // Then
      expect(result).toBe(false);
    });

    it('should return false when entry is exactly at expiration time', () => {
      // Given
      const now = Date.now();
      const entry: SwrEntry<string> = {
        value: 'test',
        cachedAt: now - 10000,
        staleAt: now - 5000,
        expiresAt: now,
      };

      // When
      const result = service.isExpired(entry);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('shouldRevalidate', () => {
    it('should return true when no job is running for key', () => {
      // Given
      const key = 'test-key';

      // When
      const result = service.shouldRevalidate(key);

      // Then
      expect(result).toBe(true);
    });

    it('should return false when job is already scheduled', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');
      const onSuccess = vi.fn();

      // Schedule a job
      await service.scheduleRevalidation(key, loader, onSuccess);

      // When
      const result = service.shouldRevalidate(key);

      // Then
      expect(result).toBe(false);

      // Cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('scheduleRevalidation', () => {
    it('should schedule revalidation job', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('new-value');
      const onSuccess = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(loader).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledWith('new-value');
    });

    it('should not schedule duplicate job for same key', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');
      const onSuccess = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess);
      await service.scheduleRevalidation(key, loader, onSuccess);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should call onError when loader fails', async () => {
      // Given
      const key = 'test-key';
      const error = new Error('Loader failed');
      const loader = vi.fn().mockRejectedValue(error);
      const onSuccess = vi.fn();
      const onError = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess, onError);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onError).toHaveBeenCalledWith(error);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('should use default error handler when onError not provided', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockRejectedValue(new Error('Failed'));
      const onSuccess = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('should remove job after completion', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');
      const onSuccess = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then
      expect(service.shouldRevalidate(key)).toBe(true);
    });

    it('should handle onSuccess errors', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');
      const onSuccess = vi.fn().mockRejectedValue(new Error('onSuccess failed'));
      const onError = vi.fn();

      // When
      await service.scheduleRevalidation(key, loader, onSuccess, onError);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('createSwrEntry', () => {
    it('should create SWR entry with correct timestamps', () => {
      // Given
      const value = 'test-value';
      const freshTtl = 60; // 60 seconds
      const now = Date.now();

      // When
      const entry = service.createSwrEntry(value, freshTtl);

      // Then
      expect(entry.value).toBe('test-value');
      expect(entry.cachedAt).toBeGreaterThanOrEqual(now);
      expect(entry.staleAt).toBe(entry.cachedAt + 60000); // 60 seconds in ms
      expect(entry.expiresAt).toBe(entry.cachedAt + 60000 + 300000); // 60s + 300s (configured defaultStaleTime)
    });

    it('should use custom staleTtl when provided', () => {
      // Given
      const value = 'test-value';
      const freshTtl = 60;
      const staleTtl = 600; // 10 minutes

      // When
      const entry = service.createSwrEntry(value, freshTtl, staleTtl);

      // Then
      expect(entry.expiresAt).toBe(entry.cachedAt + 60000 + 600000);
    });

    it('should use default staleTtl when not provided', () => {
      // Given
      const value = 'test-value';
      const freshTtl = 60;

      // When
      const entry = service.createSwrEntry(value, freshTtl);

      // Then
      // Default staleTtl is 300 seconds
      expect(entry.expiresAt).toBe(entry.cachedAt + 60000 + 300000);
    });

    it('should handle zero freshTtl', () => {
      // Given
      const value = 'test-value';
      const freshTtl = 0;

      // When
      const entry = service.createSwrEntry(value, freshTtl);

      // Then
      expect(entry.staleAt).toBe(entry.cachedAt);
      expect(entry.expiresAt).toBe(entry.cachedAt + 300000);
    });

    it('should create entry with object value', () => {
      // Given
      const value = { id: 123, name: 'test' };
      const freshTtl = 60;

      // When
      const entry = service.createSwrEntry(value, freshTtl);

      // Then
      expect(entry.value).toEqual({ id: 123, name: 'test' });
    });
  });

  describe('getStats', () => {
    it('should return zero active revalidations initially', () => {
      // Given/When
      const stats = service.getStats();

      // Then
      expect(stats.activeRevalidations).toBe(0);
    });

    it('should count active revalidations', async () => {
      // Given
      const loader1 = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('val1'), 100)));
      const loader2 = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('val2'), 100)));
      await service.scheduleRevalidation('key1', loader1, vi.fn());
      await service.scheduleRevalidation('key2', loader2, vi.fn());

      // When
      const stats = service.getStats();

      // Then
      expect(stats.activeRevalidations).toBe(2);

      // Cleanup
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    it('should return enabled status', () => {
      // Given/When
      const stats = service.getStats();

      // Then
      expect(stats.enabled).toBe(true);
    });

    it('should return staleTtl from configured defaultStaleTime', () => {
      // Given/When
      const stats = service.getStats();

      // Then
      expect(stats.staleTtl).toBe(300); // Configured via defaultStaleTime: 300
    });
  });

  describe('clearRevalidations', () => {
    it('should clear all scheduled jobs', async () => {
      // Given
      const loader = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('val'), 100)));
      await service.scheduleRevalidation('key1', loader, vi.fn());
      await service.scheduleRevalidation('key2', loader, vi.fn());

      // When
      await service.clearRevalidations();

      // Then
      const stats = service.getStats();
      expect(stats.activeRevalidations).toBe(0);

      // Cleanup
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    it('should allow scheduling new jobs after clear', async () => {
      // Given
      await service.clearRevalidations();

      // When
      const loader = vi.fn().mockResolvedValue('value');
      await service.scheduleRevalidation('key1', loader, vi.fn());

      // Then
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(loader).toHaveBeenCalled();
    });
  });
});
