import { describe, it, expect } from 'vitest';
import { CacheKey } from '../../src/cache/domain/value-objects/cache-key.vo';

describe('CacheKey', () => {
  describe('create', () => {
    it('should create valid cache key', () => {
      // Given
      const key = 'user:123';

      // When
      const cacheKey = CacheKey.create(key, { prefix: 'cache:' });

      // Then
      expect(cacheKey.getRaw()).toBe(key);
      expect(cacheKey.toString()).toBe('cache:user:123');
    });

    it('should create key without prefix', () => {
      // Given
      const key = 'user:123';

      // When
      const cacheKey = CacheKey.create(key);

      // Then
      expect(cacheKey.getRaw()).toBe(key);
      expect(cacheKey.toString()).toBe(key);
    });

    it('should throw error for empty key', () => {
      // Given
      const key = '';

      // When/Then
      expect(() => CacheKey.create(key)).toThrow(/cannot be empty/i);
    });

    it('should throw error for whitespace-only key', () => {
      // Given
      const key = '   ';

      // When/Then
      expect(() => CacheKey.create(key)).toThrow(/cannot be empty/i);
    });

    it('should throw error for key with whitespace', () => {
      // Given
      const key = 'user 123';

      // When/Then
      expect(() => CacheKey.create(key)).toThrow(/whitespace/i);
    });

    it('should throw error for invalid characters', () => {
      // Given
      const key = 'user@123';

      // When/Then
      expect(() => CacheKey.create(key)).toThrow(/invalid characters/i);
    });

    it('should throw error for key exceeding max length', () => {
      // Given
      const key = 'a'.repeat(600);

      // When/Then
      expect(() => CacheKey.create(key)).toThrow(/exceeds maximum length/i);
    });

    it('should accept key with allowed characters', () => {
      // Given
      const key = 'user-123_test.key:value';

      // When
      const cacheKey = CacheKey.create(key);

      // Then
      expect(cacheKey.getRaw()).toBe(key);
    });

    it('should support version in key', () => {
      // Given
      const key = 'user:123';

      // When
      const cacheKey = CacheKey.create(key, { version: 'v1', prefix: 'cache:' });

      // Then
      expect(cacheKey.toString()).toBe('cache:v1:user:123');
      expect(cacheKey.getVersion()).toBe('v1');
    });

    it('should support custom separator', () => {
      // Given
      const key = 'user:123';

      // When
      const cacheKey = CacheKey.create(key, {
        version: 'v1',
        prefix: 'cache',
        separator: '/',
      });

      // Then
      expect(cacheKey.toString()).toContain('/');
    });
  });

  describe('equals', () => {
    it('should return true for equal keys', () => {
      // Given
      const key1 = CacheKey.create('user:123', { prefix: 'cache:' });
      const key2 = CacheKey.create('user:123', { prefix: 'cache:' });

      // When
      const result = key1.equals(key2);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for different keys', () => {
      // Given
      const key1 = CacheKey.create('user:123', { prefix: 'cache:' });
      const key2 = CacheKey.create('user:456', { prefix: 'cache:' });

      // When
      const result = key1.equals(key2);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for different prefixes', () => {
      // Given
      const key1 = CacheKey.create('user:123', { prefix: 'cache:' });
      const key2 = CacheKey.create('user:123', { prefix: 'other:' });

      // When
      const result = key1.equals(key2);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('getters', () => {
    it('should get raw key', () => {
      // Given
      const cacheKey = CacheKey.create('user:123', { prefix: 'cache:' });

      // When
      const raw = cacheKey.getRaw();

      // Then
      expect(raw).toBe('user:123');
    });

    it('should get prefix', () => {
      // Given
      const cacheKey = CacheKey.create('user:123', { prefix: 'cache:' });

      // When
      const prefix = cacheKey.getPrefix();

      // Then
      expect(prefix).toBe('cache:');
    });

    it('should get version', () => {
      // Given
      const cacheKey = CacheKey.create('user:123', { version: 'v1' });

      // When
      const version = cacheKey.getVersion();

      // Then
      expect(version).toBe('v1');
    });
  });

  describe('toString', () => {
    it('should return full key with prefix', () => {
      // Given
      const cacheKey = CacheKey.create('user:123', { prefix: 'cache:' });

      // When
      const result = cacheKey.toString();

      // Then
      expect(result).toBe('cache:user:123');
    });

    it('should return full key with version and prefix', () => {
      // Given
      const cacheKey = CacheKey.create('user:123', {
        prefix: 'cache:',
        version: 'v1',
      });

      // When
      const result = cacheKey.toString();

      // Then
      expect(result).toBe('cache:v1:user:123');
    });
  });
});
