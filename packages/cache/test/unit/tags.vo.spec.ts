import { describe, it, expect, beforeEach } from 'vitest';
import { Tags } from '../../src/cache/domain/value-objects/tags.vo';
import { Tag } from '../../src/cache/domain/value-objects/tag.vo';

describe('Tags', () => {
  describe('create', () => {
    it('should create tags collection from array', () => {
      // Given
      const values = ['users', 'products'];

      // When
      const tags = Tags.create(values);

      // Then
      expect(tags.size()).toBe(2);
      expect(tags.toStrings()).toEqual(['users', 'products']);
    });

    it('should remove duplicate tags', () => {
      // Given
      const values = ['users', 'users', 'products'];

      // When
      const tags = Tags.create(values);

      // Then
      expect(tags.size()).toBe(2);
      expect(tags.toStrings()).toContain('users');
      expect(tags.toStrings()).toContain('products');
    });

    it('should throw error for too many tags', () => {
      // Given
      const values = Array.from({ length: 20 }, (_, i) => `tag${i}`);

      // When/Then
      expect(() => Tags.create(values)).toThrow(/too many tags/i);
    });

    it('should accept custom max tags', () => {
      // Given
      const values = ['tag1', 'tag2', 'tag3'];

      // When
      const tags = Tags.create(values, 5);

      // Then
      expect(tags.size()).toBe(3);
    });

    it('should reject when exceeding custom max tags', () => {
      // Given
      const values = ['tag1', 'tag2', 'tag3'];

      // When/Then
      expect(() => Tags.create(values, 2)).toThrow(/too many tags/i);
    });

    it('should normalize tags during creation', () => {
      // Given
      const values = ['Users', 'PRODUCTS', 'orders'];

      // When
      const tags = Tags.create(values);

      // Then
      expect(tags.toStrings()).toEqual(['users', 'products', 'orders']);
    });

    it('should handle duplicate tags after normalization', () => {
      // Given
      const values = ['Users', 'users', 'USERS'];

      // When
      const tags = Tags.create(values);

      // Then
      expect(tags.size()).toBe(1);
      expect(tags.toStrings()).toEqual(['users']);
    });

    it('should validate each tag', () => {
      // Given
      const values = ['valid', 'invalid@tag'];

      // When/Then
      expect(() => Tags.create(values)).toThrow(/invalid.*characters/i);
    });
  });

  describe('empty', () => {
    it('should create empty tags collection', () => {
      // Given/When
      const tags = Tags.empty();

      // Then
      expect(tags.size()).toBe(0);
      expect(tags.isEmpty()).toBe(true);
    });
  });

  describe('toStrings', () => {
    it('should return array of tag strings', () => {
      // Given
      const tags = Tags.create(['users', 'products']);

      // When
      const result = tags.toStrings();

      // Then
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['users', 'products']);
    });

    it('should return empty array for empty tags', () => {
      // Given
      const tags = Tags.empty();

      // When
      const result = tags.toStrings();

      // Then
      expect(result).toEqual([]);
    });
  });

  describe('toArray', () => {
    it('should return array of Tag objects', () => {
      // Given
      const tags = Tags.create(['users', 'products']);

      // When
      const result = tags.toArray();

      // Then
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toBeInstanceOf(Tag);
    });
  });

  describe('size', () => {
    it('should return number of tags', () => {
      // Given
      const tags = Tags.create(['users', 'products', 'orders']);

      // When
      const size = tags.size();

      // Then
      expect(size).toBe(3);
    });

    it('should return 0 for empty tags', () => {
      // Given
      const tags = Tags.empty();

      // When
      const size = tags.size();

      // Then
      expect(size).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true if tag exists', () => {
      // Given
      const tags = Tags.create(['users', 'products']);
      const tag = Tag.create('users');

      // When
      const result = tags.has(tag);

      // Then
      expect(result).toBe(true);
    });

    it('should return false if tag does not exist', () => {
      // Given
      const tags = Tags.create(['users', 'products']);
      const tag = Tag.create('orders');

      // When
      const result = tags.has(tag);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty tags', () => {
      // Given
      const tags = Tags.empty();

      // When
      const result = tags.isEmpty();

      // Then
      expect(result).toBe(true);
    });

    it('should return false for non-empty tags', () => {
      // Given
      const tags = Tags.create(['users']);

      // When
      const result = tags.isEmpty();

      // Then
      expect(result).toBe(false);
    });
  });

  describe('forEach', () => {
    it('should iterate over tags', () => {
      // Given
      const tags = Tags.create(['users', 'products']);
      const visited: string[] = [];

      // When
      tags.forEach((tag) => {
        visited.push(tag.toString());
      });

      // Then
      expect(visited).toEqual(['users', 'products']);
    });

    it('should provide index in callback', () => {
      // Given
      const tags = Tags.create(['users', 'products']);
      const indices: number[] = [];

      // When
      tags.forEach((_, index) => {
        indices.push(index);
      });

      // Then
      expect(indices).toEqual([0, 1]);
    });
  });

  describe('map', () => {
    it('should map over tags', () => {
      // Given
      const tags = Tags.create(['users', 'products']);

      // When
      const result = tags.map((tag) => tag.toString().toUpperCase());

      // Then
      expect(result).toEqual(['USERS', 'PRODUCTS']);
    });

    it('should provide index in callback', () => {
      // Given
      const tags = Tags.create(['users', 'products']);

      // When
      const result = tags.map((tag, index) => `${index}:${tag.toString()}`);

      // Then
      expect(result).toEqual(['0:users', '1:products']);
    });

    it('should return empty array for empty tags', () => {
      // Given
      const tags = Tags.empty();

      // When
      const result = tags.map((tag) => tag.toString());

      // Then
      expect(result).toEqual([]);
    });
  });
});
