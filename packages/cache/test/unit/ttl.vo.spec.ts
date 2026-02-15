import { describe, it, expect } from 'vitest';
import { TTL } from '../../src/cache/domain/value-objects/ttl.vo';

describe('TTL', () => {
  describe('create', () => {
    it('should create TTL from seconds', () => {
      // Given
      const seconds = 3600;

      // When
      const ttl = TTL.create(seconds);

      // Then
      expect(ttl.toSeconds()).toBe(3600);
      expect(ttl.toMilliseconds()).toBe(3600000);
    });

    it('should throw error for zero TTL', () => {
      // Given
      const seconds = 0;

      // When/Then
      expect(() => TTL.create(seconds)).toThrow(/must be positive/i);
    });

    it('should throw error for negative TTL', () => {
      // Given
      const seconds = -10;

      // When/Then
      expect(() => TTL.create(seconds)).toThrow(/must be positive/i);
    });

    it('should throw error for TTL exceeding maximum', () => {
      // Given
      const seconds = 100000;
      const maxTtl = 86400;

      // When/Then
      expect(() => TTL.create(seconds, maxTtl)).toThrow(/exceeds maximum/i);
    });

    it('should round TTL to nearest second', () => {
      // Given
      const seconds = 3600.7;

      // When
      const ttl = TTL.create(seconds);

      // Then
      expect(ttl.toSeconds()).toBe(3601);
    });

    it('should accept custom max TTL', () => {
      // Given
      const seconds = 200000;
      const maxTtl = 300000;

      // When
      const ttl = TTL.create(seconds, maxTtl);

      // Then
      expect(ttl.toSeconds()).toBe(200000);
    });
  });

  describe('fromMilliseconds', () => {
    it('should create TTL from milliseconds', () => {
      // Given
      const ms = 5000;

      // When
      const ttl = TTL.fromMilliseconds(ms);

      // Then
      expect(ttl.toMilliseconds()).toBe(5000);
      expect(ttl.toSeconds()).toBe(5);
    });

    it('should ceil fractional seconds', () => {
      // Given
      const ms = 5500;

      // When
      const ttl = TTL.fromMilliseconds(ms);

      // Then
      expect(ttl.toSeconds()).toBe(6);
    });

    it('should throw error for negative milliseconds', () => {
      // Given
      const ms = -100;

      // When/Then
      expect(() => TTL.fromMilliseconds(ms)).toThrow(/must be positive/i);
    });
  });

  describe('comparisons', () => {
    it('should check if less than', () => {
      // Given
      const ttl1 = TTL.create(60);
      const ttl2 = TTL.create(120);

      // When
      const result = ttl1.isLessThan(ttl2);

      // Then
      expect(result).toBe(true);
    });

    it('should check if greater than', () => {
      // Given
      const ttl1 = TTL.create(120);
      const ttl2 = TTL.create(60);

      // When
      const result = ttl1.isGreaterThan(ttl2);

      // Then
      expect(result).toBe(true);
    });

    it('should return minimum TTL', () => {
      // Given
      const ttl1 = TTL.create(60);
      const ttl2 = TTL.create(120);

      // When
      const min = TTL.min(ttl1, ttl2);

      // Then
      expect(min.toSeconds()).toBe(60);
    });

    it('should return maximum TTL', () => {
      // Given
      const ttl1 = TTL.create(60);
      const ttl2 = TTL.create(120);

      // When
      const max = TTL.max(ttl1, ttl2);

      // Then
      expect(max.toSeconds()).toBe(120);
    });
  });

  describe('equals', () => {
    it('should return true for equal TTLs', () => {
      // Given
      const ttl1 = TTL.create(60);
      const ttl2 = TTL.create(60);

      // When
      const result = ttl1.equals(ttl2);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for different TTLs', () => {
      // Given
      const ttl1 = TTL.create(60);
      const ttl2 = TTL.create(120);

      // When
      const result = ttl1.equals(ttl2);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('toString', () => {
    it('should format TTL as string', () => {
      // Given
      const ttl = TTL.create(3600);

      // When
      const result = ttl.toString();

      // Then
      expect(result).toBe('3600s');
    });
  });
});
