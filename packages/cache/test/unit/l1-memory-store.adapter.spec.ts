import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { L1MemoryStoreAdapter } from '../../src/cache/infrastructure/adapters/l1-memory-store.adapter';

describe('L1MemoryStoreAdapter', () => {
  let store: L1MemoryStoreAdapter;

  beforeEach(() => {
    store = new L1MemoryStoreAdapter({ l1: { maxSize: 100, ttl: 60 } });
  });

  describe('get/set', () => {
    it('should store and retrieve value', async () => {
      // Given
      const key = 'test-key';
      const value = { id: 123, name: 'John' };

      // When
      await store.set(key, value);
      const result = await store.get(key);

      // Then
      expect(result).toEqual(value);
    });

    it('should return null for non-existent key', async () => {
      // Given
      const key = 'non-existent';

      // When
      const result = await store.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should overwrite existing value', async () => {
      // Given
      const key = 'test-key';
      await store.set(key, 'old-value');

      // When
      await store.set(key, 'new-value');
      const result = await store.get(key);

      // Then
      expect(result).toBe('new-value');
    });
  });

  describe('TTL expiration (seconds)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should treat explicit ttl as seconds, not milliseconds', async () => {
      // Given — regression for issue #10: entry used to expire ~60ms after write
      vi.useFakeTimers();
      await store.set('key', 'value', 60);

      // When — well past 60ms but within the 60s TTL
      vi.advanceTimersByTime(1_000);

      // Then — still cached (previously this was already expired)
      expect(await store.get('key')).toBe('value');
    });

    it('should keep entry until its explicit ttl elapses', async () => {
      // Given
      vi.useFakeTimers();
      await store.set('key', 'value', 60);

      // When — just before expiry
      vi.advanceTimersByTime(59_000);
      const beforeExpiry = await store.get('key');

      // When — just after expiry
      vi.advanceTimersByTime(2_000);
      const afterExpiry = await store.get('key');

      // Then
      expect(beforeExpiry).toBe('value');
      expect(afterExpiry).toBeNull();
    });

    it('should apply configured default ttl (seconds) when ttl omitted', async () => {
      // Given — default l1.ttl is 60 seconds
      vi.useFakeTimers();
      await store.set('key', 'value');

      // When
      vi.advanceTimersByTime(59_000);
      const beforeExpiry = await store.get('key');

      vi.advanceTimersByTime(2_000);
      const afterExpiry = await store.get('key');

      // Then
      expect(beforeExpiry).toBe('value');
      expect(afterExpiry).toBeNull();
    });

    it('should respect explicit ttl on overwrite of an existing key', async () => {
      // Given
      vi.useFakeTimers();
      await store.set('key', 'old', 60);

      // When — overwrite resets expiry with the new (seconds) ttl
      await store.set('key', 'new', 60);
      vi.advanceTimersByTime(1_000);

      // Then
      expect(await store.get('key')).toBe('new');
    });
  });

  describe('has', () => {
    it('should return true for existing key', async () => {
      // Given
      const key = 'test-key';
      await store.set(key, 'value');

      // When
      const exists = await store.has(key);

      // Then
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      // Given
      const key = 'non-existent';

      // When
      const exists = await store.has(key);

      // Then
      expect(exists).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      // Given
      const key = 'test-key';
      await store.set(key, 'value');

      // When
      await store.delete(key);
      const result = await store.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should not throw error for non-existent key', async () => {
      // Given
      const key = 'non-existent';

      // When/Then
      await expect(store.delete(key)).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.set('key2', 'value2');
      await store.set('key3', 'value3');

      // When
      await store.clear();

      // Then
      expect(await store.get('key1')).toBeNull();
      expect(await store.get('key2')).toBeNull();
      expect(await store.get('key3')).toBeNull();
    });
  });

  describe('size', () => {
    it('should return current size', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.set('key2', 'value2');

      // When
      const size = await store.size();

      // Then
      expect(size).toBeGreaterThan(0);
    });

    it('should return 0 for empty store', async () => {
      // Given/When
      const size = await store.size();

      // Then
      expect(size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should handle max entries configuration', async () => {
      // Given
      const smallStore = new L1MemoryStoreAdapter({ l1: { maxSize: 3 } });

      // When
      await smallStore.set('key1', { value: 'value1' });
      await smallStore.set('key2', { value: 'value2' });
      await smallStore.set('key3', { value: 'value3' });

      // Then
      const size = await smallStore.size();
      expect(size).toBe(3);
    });

    it('should evict least recently used item when exceeding max', async () => {
      // Given
      const smallStore = new L1MemoryStoreAdapter({ l1: { maxSize: 3 } });
      await smallStore.set('key1', { value: 'value1' });
      await smallStore.set('key2', { value: 'value2' });
      await smallStore.set('key3', { value: 'value3' });

      // When
      await smallStore.set('key4', { value: 'value4' }); // Should evict key1

      // Then
      const key1 = await smallStore.get('key1');
      const key4 = await smallStore.get('key4');
      expect(key1).toBeNull();
      expect(key4?.value).toBe('value4');
    });

    it('should update LRU order on access', async () => {
      // Given
      const smallStore = new L1MemoryStoreAdapter({ l1: { maxSize: 3 } });
      await smallStore.set('key1', { value: 'value1' });
      await smallStore.set('key2', { value: 'value2' });
      await smallStore.set('key3', { value: 'value3' });

      // When - access key1 to move it to front
      await smallStore.get('key1');
      await smallStore.set('key4', { value: 'value4' }); // Should evict key2, not key1

      // Then
      const key1 = await smallStore.get('key1');
      const key2 = await smallStore.get('key2');
      const key4 = await smallStore.get('key4');
      expect(key1?.value).toBe('value1'); // Still present
      expect(key2).toBeNull(); // Evicted
      expect(key4?.value).toBe('value4');
    });
  });

  describe('getStats', () => {
    it('should return stats with hits and misses', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.get('key1'); // Hit
      await store.get('key2'); // Miss

      // When
      const stats = store.getStats();

      // Then
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.size).toBeGreaterThanOrEqual(1);
    });

    it('should return zero stats for empty store', () => {
      // Given/When
      const stats = store.getStats();

      // Then
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('should track cache size correctly', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.set('key2', 'value2');

      // When
      const stats = store.getStats();

      // Then
      expect(stats.size).toBe(2);
    });

    it('should increment hits on successful get', async () => {
      // Given
      await store.set('key1', 'value1');
      const before = store.getStats();

      // When
      await store.get('key1');
      const after = store.getStats();

      // Then
      expect(after.hits).toBe(before.hits + 1);
    });

    it('should increment misses on failed get', async () => {
      // Given
      const before = store.getStats();

      // When
      await store.get('non-existent');
      const after = store.getStats();

      // Then
      expect(after.misses).toBe(before.misses + 1);
    });

    it('should update size after delete', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.set('key2', 'value2');

      // When
      await store.delete('key1');
      const stats = store.getStats();

      // Then
      expect(stats.size).toBe(1);
    });

    it('should reset size to zero after clear', async () => {
      // Given
      await store.set('key1', 'value1');
      await store.set('key2', 'value2');

      // When
      await store.clear();
      const stats = store.getStats();

      // Then
      expect(stats.size).toBe(0);
    });
  });
});
