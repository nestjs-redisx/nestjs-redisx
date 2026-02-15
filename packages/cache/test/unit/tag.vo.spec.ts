import { describe, it, expect } from 'vitest';
import { Tag } from '../../src/cache/domain/value-objects/tag.vo';

describe('Tag', () => {
  describe('create', () => {
    it('should create valid tag', () => {
      // Given
      const value = 'users';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('users');
      expect(tag.toString()).toBe('users');
    });

    it('should normalize tag to lowercase', () => {
      // Given
      const value = 'UsErS';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('users');
    });

    it('should trim whitespace', () => {
      // Given
      const value = '  users  ';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('users');
    });

    it('should accept tag with allowed characters', () => {
      // Given
      const value = 'user:123_test-tag.value';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('user:123_test-tag.value');
    });

    it('should throw error for empty tag', () => {
      // Given
      const value = '';

      // When/Then
      expect(() => Tag.create(value)).toThrow(/cannot be empty/i);
    });

    it('should throw error for whitespace-only tag', () => {
      // Given
      const value = '   ';

      // When/Then
      expect(() => Tag.create(value)).toThrow(/cannot be empty after normalization/i);
    });

    it('should throw error for tag with whitespace', () => {
      // Given
      const value = 'user tag';

      // When/Then
      expect(() => Tag.create(value)).toThrow(/cannot contain whitespace/i);
    });

    it('should throw error for invalid characters', () => {
      // Given
      const value = 'user@tag';

      // When/Then
      expect(() => Tag.create(value)).toThrow(/invalid.*characters/i);
    });

    it('should throw error for tag exceeding max length', () => {
      // Given
      const value = 'a'.repeat(200);

      // When/Then
      expect(() => Tag.create(value)).toThrow(/exceeds maximum length/i);
    });

    it('should accept custom max length', () => {
      // Given
      const value = 'a'.repeat(50);

      // When
      const tag = Tag.create(value, 100);

      // Then
      expect(tag.getRaw().length).toBe(50);
    });

    it('should reject tag exceeding custom max length', () => {
      // Given
      const value = 'a'.repeat(50);

      // When/Then
      expect(() => Tag.create(value, 10)).toThrow(/exceeds maximum length/i);
    });

    it('should accept uppercase letters and normalize them', () => {
      // Given
      const value = 'PRODUCT:123';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('product:123');
    });

    it('should accept numbers', () => {
      // Given
      const value = '12345';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('12345');
    });

    it('should accept mixed alphanumeric with separators', () => {
      // Given
      const value = 'tag-1_test:value.2';

      // When
      const tag = Tag.create(value);

      // Then
      expect(tag.getRaw()).toBe('tag-1_test:value.2');
    });
  });

  describe('equals', () => {
    it('should return true for equal tags', () => {
      // Given
      const tag1 = Tag.create('users');
      const tag2 = Tag.create('users');

      // When
      const result = tag1.equals(tag2);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for different tags', () => {
      // Given
      const tag1 = Tag.create('users');
      const tag2 = Tag.create('products');

      // When
      const result = tag1.equals(tag2);

      // Then
      expect(result).toBe(false);
    });

    it('should return true for tags with different casing', () => {
      // Given
      const tag1 = Tag.create('Users');
      const tag2 = Tag.create('USERS');

      // When
      const result = tag1.equals(tag2);

      // Then
      expect(result).toBe(true);
    });
  });

  describe('toString', () => {
    it('should return tag value', () => {
      // Given
      const tag = Tag.create('users');

      // When
      const result = tag.toString();

      // Then
      expect(result).toBe('users');
    });
  });

  describe('getRaw', () => {
    it('should return raw tag value', () => {
      // Given
      const tag = Tag.create('users');

      // When
      const result = tag.getRaw();

      // Then
      expect(result).toBe('users');
    });
  });
});
