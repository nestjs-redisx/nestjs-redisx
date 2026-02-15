import { describe, it, expect } from 'vitest';
import { JsonSerializer } from '../../src/serializers/json.serializer';

describe('JsonSerializer', () => {
  let serializer: JsonSerializer;

  beforeEach(() => {
    serializer = new JsonSerializer();
  });

  describe('serialize', () => {
    it('should serialize simple object', () => {
      // Given
      const value = { id: 123, name: 'John' };

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('{"id":123,"name":"John"}');
      expect(typeof result).toBe('string');
    });

    it('should serialize array', () => {
      // Given
      const value = [1, 2, 3, 4];

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('[1,2,3,4]');
    });

    it('should serialize string', () => {
      // Given
      const value = 'test string';

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('"test string"');
    });

    it('should serialize number', () => {
      // Given
      const value = 42;

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('42');
    });

    it('should serialize boolean', () => {
      // Given
      const value = true;

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('true');
    });

    it('should serialize null', () => {
      // Given
      const value = null;

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('null');
    });

    it('should serialize nested object', () => {
      // Given
      const value = {
        user: { id: 1, profile: { name: 'John' } },
        tags: ['a', 'b'],
      };

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toBe('{"user":{"id":1,"profile":{"name":"John"}},"tags":["a","b"]}');
    });

    it('should throw SerializationError for circular reference', () => {
      // Given
      const value: any = { name: 'test' };
      value.self = value; // Create circular reference

      // When/Then
      try {
        serializer.serialize(value);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/SerializationError/);
      }
    });

    it('should serialize Date to ISO string', () => {
      // Given
      const value = { date: new Date('2024-01-01T00:00:00.000Z') };

      // When
      const result = serializer.serialize(value);

      // Then
      expect(result).toContain('2024-01-01T00:00:00.000Z');
    });
  });

  describe('deserialize', () => {
    it('should deserialize string to object', () => {
      // Given
      const data = '{"id":123,"name":"John"}';

      // When
      const result = serializer.deserialize<{ id: number; name: string }>(data);

      // Then
      expect(result).toEqual({ id: 123, name: 'John' });
    });

    it('should deserialize buffer to object', () => {
      // Given
      const data = Buffer.from('{"id":123,"name":"John"}', 'utf8');

      // When
      const result = serializer.deserialize<{ id: number; name: string }>(data);

      // Then
      expect(result).toEqual({ id: 123, name: 'John' });
    });

    it('should deserialize array', () => {
      // Given
      const data = '[1,2,3,4]';

      // When
      const result = serializer.deserialize<number[]>(data);

      // Then
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it('should deserialize string value', () => {
      // Given
      const data = '"test string"';

      // When
      const result = serializer.deserialize<string>(data);

      // Then
      expect(result).toBe('test string');
    });

    it('should deserialize number', () => {
      // Given
      const data = '42';

      // When
      const result = serializer.deserialize<number>(data);

      // Then
      expect(result).toBe(42);
    });

    it('should deserialize boolean', () => {
      // Given
      const data = 'true';

      // When
      const result = serializer.deserialize<boolean>(data);

      // Then
      expect(result).toBe(true);
    });

    it('should deserialize null', () => {
      // Given
      const data = 'null';

      // When
      const result = serializer.deserialize(data);

      // Then
      expect(result).toBeNull();
    });

    it('should throw SerializationError for invalid JSON', () => {
      // Given
      const data = '{invalid json}';

      // When/Then
      try {
        serializer.deserialize(data);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/SerializationError/);
      }
    });

    it('should throw SerializationError for empty string', () => {
      // Given
      const data = '';

      // When/Then
      try {
        serializer.deserialize(data);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/SerializationError/);
      }
    });

    it('should deserialize nested object', () => {
      // Given
      const data = '{"user":{"id":1,"profile":{"name":"John"}},"tags":["a","b"]}';

      // When
      const result = serializer.deserialize(data);

      // Then
      expect(result).toEqual({
        user: { id: 1, profile: { name: 'John' } },
        tags: ['a', 'b'],
      });
    });
  });

  describe('tryDeserialize', () => {
    it('should deserialize valid JSON', () => {
      // Given
      const data = '{"id":123}';

      // When
      const result = serializer.tryDeserialize<{ id: number }>(data);

      // Then
      expect(result).toEqual({ id: 123 });
    });

    it('should return null for invalid JSON', () => {
      // Given
      const data = '{invalid}';

      // When
      const result = serializer.tryDeserialize(data);

      // Then
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      // Given
      const data = '';

      // When
      const result = serializer.tryDeserialize(data);

      // Then
      expect(result).toBeNull();
    });

    it('should deserialize buffer', () => {
      // Given
      const data = Buffer.from('{"id":123}', 'utf8');

      // When
      const result = serializer.tryDeserialize<{ id: number }>(data);

      // Then
      expect(result).toEqual({ id: 123 });
    });

    it('should return null for malformed buffer', () => {
      // Given
      const data = Buffer.from('{malformed', 'utf8');

      // When
      const result = serializer.tryDeserialize(data);

      // Then
      expect(result).toBeNull();
    });
  });

  describe('getContentType', () => {
    it('should return correct content type', () => {
      // Given/When
      const contentType = serializer.getContentType();

      // Then
      expect(contentType).toBe('application/json');
    });
  });

  describe('round-trip serialization', () => {
    it('should serialize and deserialize object correctly', () => {
      // Given
      const original = { id: 123, name: 'John', active: true, tags: ['a', 'b'] };

      // When
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<typeof original>(serialized);

      // Then
      expect(deserialized).toEqual(original);
    });

    it('should serialize and deserialize array correctly', () => {
      // Given
      const original = [1, 'two', true, { id: 4 }];

      // When
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<typeof original>(serialized);

      // Then
      expect(deserialized).toEqual(original);
    });

    it('should serialize and deserialize with Buffer', () => {
      // Given
      const original = { id: 123, name: 'Test' };

      // When
      const serialized = serializer.serialize(original);
      const buffer = Buffer.from(serialized, 'utf8');
      const deserialized = serializer.deserialize<typeof original>(buffer);

      // Then
      expect(deserialized).toEqual(original);
    });
  });
});
