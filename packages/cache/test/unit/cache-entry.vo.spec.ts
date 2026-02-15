import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CacheEntry } from '../../src/cache/domain/value-objects/cache-entry.vo';

describe('CacheEntry', () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('should create cache entry with value and ttl', () => {
      // Given
      const value = { id: 123, name: 'John' };
      const ttl = 60;

      // When
      const entry = CacheEntry.create(value, ttl);

      // Then
      expect(entry.value).toEqual(value);
      expect(entry.ttl).toBe(60);
      expect(entry.cachedAt).toBe(now);
    });

    it('should create cache entry with tags', () => {
      // Given
      const value = 'test';
      const ttl = 60;
      const tags = ['tag1', 'tag2'];

      // When
      const entry = CacheEntry.create(value, ttl, tags);

      // Then
      expect(entry.tags).toEqual(['tag1', 'tag2']);
    });

    it('should create cache entry without tags', () => {
      // Given
      const value = 'test';
      const ttl = 60;

      // When
      const entry = CacheEntry.create(value, ttl);

      // Then
      expect(entry.tags).toBeUndefined();
    });
  });

  describe('isExpired', () => {
    it('should return false for fresh entry', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      const result = entry.isExpired();

      // Then
      expect(result).toBe(false);
    });

    it('should return true for expired entry', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(61 * 1000); // Advance 61 seconds
      const result = entry.isExpired();

      // Then
      expect(result).toBe(true);
    });

    it('should return false at exact expiration time', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(60 * 1000); // Advance exactly 60 seconds
      const result = entry.isExpired();

      // Then
      expect(result).toBe(false);
    });

    it('should return true after expiration time', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(60 * 1000 + 1); // Advance 60 seconds + 1ms
      const result = entry.isExpired();

      // Then
      expect(result).toBe(true);
    });
  });

  describe('getTimeToLive', () => {
    it('should return remaining time for fresh entry', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(30 * 1000); // Advance 30 seconds
      const ttl = entry.getTimeToLive();

      // Then
      expect(ttl).toBe(30 * 1000); // 30 seconds remaining
    });

    it('should return 0 for expired entry', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(70 * 1000); // Advance 70 seconds
      const ttl = entry.getTimeToLive();

      // Then
      expect(ttl).toBe(0);
    });

    it('should return full ttl immediately after creation', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      const ttl = entry.getTimeToLive();

      // Then
      expect(ttl).toBe(60 * 1000);
    });
  });

  describe('getAge', () => {
    it('should return 0 immediately after creation', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      const age = entry.getAge();

      // Then
      expect(age).toBe(0);
    });

    it('should return elapsed time since creation', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(30 * 1000); // Advance 30 seconds
      const age = entry.getAge();

      // Then
      expect(age).toBe(30 * 1000);
    });

    it('should return age even for expired entry', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      vi.advanceTimersByTime(90 * 1000); // Advance 90 seconds
      const age = entry.getAge();

      // Then
      expect(age).toBe(90 * 1000);
    });
  });

  describe('hasTag', () => {
    it('should return true if entry has tag', () => {
      // Given
      const entry = CacheEntry.create('value', 60, ['tag1', 'tag2']);

      // When
      const result = entry.hasTag('tag1');

      // Then
      expect(result).toBe(true);
    });

    it('should return false if entry does not have tag', () => {
      // Given
      const entry = CacheEntry.create('value', 60, ['tag1', 'tag2']);

      // When
      const result = entry.hasTag('tag3');

      // Then
      expect(result).toBe(false);
    });

    it('should return false if entry has no tags', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      const result = entry.hasTag('tag1');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize entry to JSON', () => {
      // Given
      const value = { id: 123 };
      const entry = CacheEntry.create(value, 60, ['tag1']);

      // When
      const json = entry.toJSON();

      // Then
      expect(json).toEqual({
        value: { id: 123 },
        cachedAt: now,
        ttl: 60,
        tags: ['tag1'],
      });
    });

    it('should serialize entry without tags', () => {
      // Given
      const entry = CacheEntry.create('value', 60);

      // When
      const json = entry.toJSON();

      // Then
      expect(json).toEqual({
        value: 'value',
        cachedAt: now,
        ttl: 60,
        tags: undefined,
      });
    });
  });

  describe('fromJSON', () => {
    it('should deserialize entry from JSON', () => {
      // Given
      const json = {
        value: { id: 123 },
        cachedAt: now,
        ttl: 60,
        tags: ['tag1'],
      };

      // When
      const entry = CacheEntry.fromJSON(json);

      // Then
      expect(entry.value).toEqual({ id: 123 });
      expect(entry.cachedAt).toBe(now);
      expect(entry.ttl).toBe(60);
      expect(entry.tags).toEqual(['tag1']);
    });

    it('should deserialize entry without tags', () => {
      // Given
      const json = {
        value: 'value',
        cachedAt: now,
        ttl: 60,
      };

      // When
      const entry = CacheEntry.fromJSON(json);

      // Then
      expect(entry.value).toBe('value');
      expect(entry.tags).toBeUndefined();
    });
  });

  describe('roundtrip', () => {
    it('should handle toJSON/fromJSON roundtrip', () => {
      // Given
      const original = CacheEntry.create({ id: 123 }, 60, ['tag1']);

      // When
      const json = original.toJSON();
      const restored = CacheEntry.fromJSON(json);

      // Then
      expect(restored.value).toEqual(original.value);
      expect(restored.cachedAt).toBe(original.cachedAt);
      expect(restored.ttl).toBe(original.ttl);
      expect(restored.tags).toEqual(original.tags);
    });
  });
});
