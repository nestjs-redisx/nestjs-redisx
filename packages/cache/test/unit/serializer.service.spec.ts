import { describe, it, expect } from 'vitest';
import { Serializer } from '../../src/cache/domain/services/serializer.service';

describe('Serializer', () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe('serialize', () => {
    it('should serialize object to string', () => {
      // Given
      const obj = { id: 123, name: 'John' };

      // When
      const result = serializer.serialize(obj);

      // Then
      expect(typeof result).toBe('string');
      expect(result).toContain('John');
    });

    it('should serialize null', () => {
      // Given
      const value = null;

      // When
      const result = serializer.serialize(value);

      // Then
      expect(typeof result).toBe('string');
    });

    it('should serialize undefined as JSON undefined', () => {
      // Given
      const value = undefined;

      // When
      const result = serializer.serialize(value);

      // Then
      // JSON.stringify(undefined) returns undefined
      expect(result).toBeUndefined();
    });

    it('should serialize array', () => {
      // Given
      const arr = [1, 2, 3];

      // When
      const result = serializer.serialize(arr);

      // Then
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should serialize nested object', () => {
      // Given
      const obj = {
        user: { id: 1, profile: { name: 'John' } },
        tags: ['a', 'b'],
      };

      // When
      const result = serializer.serialize(obj);

      // Then
      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.user.profile.name).toBe('John');
    });

    it('should throw error for circular reference', () => {
      // Given
      const obj: any = { name: 'test' };
      obj.self = obj;

      // When/Then
      expect(() => serializer.serialize(obj)).toThrow(/circular|serialization/i);
    });
  });

  describe('deserialize', () => {
    it('should deserialize string to object', () => {
      // Given
      const serialized = serializer.serialize({ id: 123, name: 'John' });

      // When
      const result = serializer.deserialize<{ id: number; name: string }>(serialized);

      // Then
      expect(result).toEqual({ id: 123, name: 'John' });
    });

    it('should deserialize null', () => {
      // Given
      const serialized = serializer.serialize(null);

      // When
      const result = serializer.deserialize(serialized);

      // Then
      expect(result).toBeNull();
    });

    it('should deserialize array', () => {
      // Given
      const arr = [1, 2, 3];
      const serialized = serializer.serialize(arr);

      // When
      const result = serializer.deserialize<number[]>(serialized);

      // Then
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should throw error for invalid JSON', () => {
      // Given
      const invalid = 'not valid json {[}]';

      // When/Then
      expect(() => serializer.deserialize(invalid)).toThrow(/serialization/i);
    });

    it('should deserialize nested object', () => {
      // Given
      const obj = {
        user: { id: 1, profile: { name: 'John' } },
        tags: ['a', 'b'],
      };
      const serialized = serializer.serialize(obj);

      // When
      const result = serializer.deserialize(serialized);

      // Then
      expect(result).toEqual(obj);
    });
  });

  describe('roundtrip', () => {
    it('should handle serialize-deserialize roundtrip', () => {
      // Given
      const original = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { a: 1, b: { c: 2 } },
      };

      // When
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize(serialized);

      // Then
      expect(deserialized).toEqual(original);
    });
  });
});
