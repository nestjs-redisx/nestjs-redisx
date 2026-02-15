import { describe, it, expect, beforeEach } from 'vitest';
import { KeyBuilder } from '../../src/key-builder';

describe('KeyBuilder', () => {
  describe('create', () => {
    it('should create new instance with default options', () => {
      // Given/When
      const builder = KeyBuilder.create();

      // Then
      expect(builder).toBeInstanceOf(KeyBuilder);
    });

    it('should create instance with custom separator', () => {
      // Given
      const builder = KeyBuilder.create({ separator: '/' });

      // When
      const key = builder.segment('a').segment('b').build();

      // Then
      expect(key).toBe('a/b');
    });

    it('should create instance with custom max length', () => {
      // Given
      const builder = KeyBuilder.create({ maxLength: 10 });

      // When/Then
      try {
        builder.segment('very').segment('long').segment('key').segment('here').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should create instance with validation disabled', () => {
      // Given
      const builder = KeyBuilder.create({ validate: false });

      // When
      const key = builder.segment('a:b').segment('c d').build();

      // Then - should not throw despite invalid characters
      expect(key).toBe('a:b:c d');
    });

    it('should create instance with lowercase enabled', () => {
      // Given
      const builder = KeyBuilder.create({ lowercase: true });

      // When
      const key = builder.segment('User').segment('Profile').build();

      // Then
      expect(key).toBe('user:profile');
    });
  });

  describe('fromTemplate', () => {
    it('should create key from template', () => {
      // Given
      const template = 'user:{id}';
      const params = { id: '123' };

      // When
      const key = KeyBuilder.fromTemplate(template, params);

      // Then
      expect(key).toBe('user:123');
    });

    it('should create key with multiple placeholders', () => {
      // Given
      const template = 'user:{userId}:post:{postId}';
      const params = { userId: '123', postId: '456' };

      // When
      const key = KeyBuilder.fromTemplate(template, params);

      // Then
      expect(key).toBe('user:123:post:456');
    });

    it('should handle numeric params', () => {
      // Given
      const template = 'item:{id}';
      const params = { id: 789 };

      // When
      const key = KeyBuilder.fromTemplate(template, params);

      // Then
      expect(key).toBe('item:789');
    });

    it('should throw error when param not found', () => {
      // Given
      const template = 'user:{id}:profile:{name}';
      const params = { id: '123' };

      // When/Then
      try {
        KeyBuilder.fromTemplate(template, params);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw error when param is null', () => {
      // Given
      const template = 'user:{id}';
      const params = { id: null as any };

      // When/Then
      try {
        KeyBuilder.fromTemplate(template, params);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw error when param is undefined', () => {
      // Given
      const template = 'user:{id}';
      const params = { id: undefined as any };

      // When/Then
      try {
        KeyBuilder.fromTemplate(template, params);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });
  });

  describe('fromSegments', () => {
    it('should create key from segments array', () => {
      // Given
      const segments = ['user', '123', 'profile'];

      // When
      const key = KeyBuilder.fromSegments(segments);

      // Then
      expect(key).toBe('user:123:profile');
    });

    it('should create key with custom separator', () => {
      // Given
      const segments = ['a', 'b', 'c'];

      // When
      const key = KeyBuilder.fromSegments(segments, { separator: '/' });

      // Then
      expect(key).toBe('a/b/c');
    });

    it('should handle single segment', () => {
      // Given
      const segments = ['user'];

      // When
      const key = KeyBuilder.fromSegments(segments);

      // Then
      expect(key).toBe('user');
    });
  });

  describe('namespace', () => {
    it('should add namespace as first segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('user').namespace('app').build();

      // Then
      expect(key).toBe('app:user');
    });

    it('should support chaining', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.namespace('app').segment('user').segment('123').build();

      // Then
      expect(key).toBe('app:user:123');
    });
  });

  describe('prefix', () => {
    it('should add prefix segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.prefix('cache').segment('user').build();

      // Then
      expect(key).toBe('cache:user');
    });
  });

  describe('version', () => {
    it('should add version segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.version('v2').segment('user').build();

      // Then
      expect(key).toBe('v2:user');
    });
  });

  describe('segment', () => {
    it('should add string segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('user').build();

      // Then
      expect(key).toBe('user');
    });

    it('should add numeric segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment(123).build();

      // Then
      expect(key).toBe('123');
    });

    it('should trim segments', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('  user  ').build();

      // Then
      expect(key).toBe('user');
    });

    it('should throw error for empty segment', () => {
      // Given
      const builder = KeyBuilder.create();

      // When/Then
      try {
        builder.segment('  ').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw error for segment with separator', () => {
      // Given
      const builder = KeyBuilder.create();

      // When/Then
      try {
        builder.segment('user:123').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw error for segment with curly braces', () => {
      // Given
      const builder = KeyBuilder.create();

      // When/Then
      try {
        builder.segment('user{id}').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw error for segment with spaces', () => {
      // Given
      const builder = KeyBuilder.create();

      // When/Then
      try {
        builder.segment('user profile').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should support chaining', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('a').segment('b').segment('c').build();

      // Then
      expect(key).toBe('a:b:c');
    });
  });

  describe('segments', () => {
    it('should add multiple segments', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segments('user', '123', 'profile').build();

      // Then
      expect(key).toBe('user:123:profile');
    });

    it('should handle mixed string and number segments', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segments('user', 123, 'data').build();

      // Then
      expect(key).toBe('user:123:data');
    });
  });

  describe('tag', () => {
    it('should add tag prefix and value', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.tag('users').build();

      // Then
      expect(key).toBe('tag:users');
    });

    it('should support chaining with other segments', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('cache').tag('users').build();

      // Then
      expect(key).toBe('cache:tag:users');
    });
  });

  describe('timestamp', () => {
    it('should add current timestamp by default', () => {
      // Given
      const builder = KeyBuilder.create();
      const before = Date.now();

      // When
      const key = builder.segment('event').timestamp().build();

      // Then
      expect(key).toMatch(/^event:\d+$/);
      const timestamp = parseInt(key.split(':')[1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
    });

    it('should add custom timestamp', () => {
      // Given
      const builder = KeyBuilder.create();
      const customTime = 1704067200000;

      // When
      const key = builder.segment('event').timestamp(customTime).build();

      // Then
      expect(key).toBe('event:1704067200000');
    });
  });

  describe('hash', () => {
    it('should add hash segment from object', () => {
      // Given
      const builder = KeyBuilder.create();
      const obj = { id: 123, name: 'test' };

      // When
      const key = builder.segment('cache').hash(obj).build();

      // Then
      expect(key).toMatch(/^cache:[a-z0-9]+$/);
    });

    it('should produce same hash for same object', () => {
      // Given
      const obj = { id: 123, name: 'test' };

      // When
      const key1 = KeyBuilder.create().hash(obj).build();
      const key2 = KeyBuilder.create().hash(obj).build();

      // Then
      expect(key1).toBe(key2);
    });

    it('should produce different hash for different objects', () => {
      // Given
      const obj1 = { id: 123 };
      const obj2 = { id: 456 };

      // When
      const key1 = KeyBuilder.create().hash(obj1).build();
      const key2 = KeyBuilder.create().hash(obj2).build();

      // Then
      expect(key1).not.toBe(key2);
    });
  });

  describe('build', () => {
    it('should throw error when no segments', () => {
      // Given
      const builder = KeyBuilder.create();

      // When/Then
      try {
        builder.build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should validate max length', () => {
      // Given
      const builder = KeyBuilder.create({ maxLength: 20 });

      // When/Then
      try {
        builder.segments('very', 'long', 'key', 'that', 'exceeds', 'limit').build();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should allow building multiple keys from same builder', () => {
      // Given
      const builder = KeyBuilder.create();
      builder.segment('user');

      // When
      const key1 = builder.segment('123').build();
      const key2 = builder.segment('456').build();

      // Then
      expect(key1).toBe('user:123');
      expect(key2).toBe('user:123:456');
    });
  });

  describe('reset', () => {
    it('should clear all segments', () => {
      // Given
      const builder = KeyBuilder.create();
      builder.segments('a', 'b', 'c');

      // When
      builder.reset();
      const key = builder.segment('d').build();

      // Then
      expect(key).toBe('d');
    });

    it('should allow reusing builder', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key1 = builder.segment('user').segment('123').build();
      builder.reset();
      const key2 = builder.segment('post').segment('456').build();

      // Then
      expect(key1).toBe('user:123');
      expect(key2).toBe('post:456');
    });

    it('should support chaining', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const key = builder.segment('old').reset().segment('new').build();

      // Then
      expect(key).toBe('new');
    });
  });

  describe('getSegments', () => {
    it('should return array of segments', () => {
      // Given
      const builder = KeyBuilder.create();
      builder.segments('a', 'b', 'c');

      // When
      const segments = builder.getSegments();

      // Then
      expect(segments).toEqual(['a', 'b', 'c']);
    });

    it('should return copy of segments', () => {
      // Given
      const builder = KeyBuilder.create();
      builder.segments('a', 'b');

      // When
      const segments = builder.getSegments();
      segments.push('c');

      // Then
      expect(builder.getSegments()).toEqual(['a', 'b']);
    });

    it('should return empty array for new builder', () => {
      // Given
      const builder = KeyBuilder.create();

      // When
      const segments = builder.getSegments();

      // Then
      expect(segments).toEqual([]);
    });
  });

  describe('complex scenarios', () => {
    it('should build multi-level key with namespace', () => {
      // Given/When
      const key = KeyBuilder.create().namespace('app').prefix('cache').version('v2').segment('user').segment('123').segment('profile').build();

      // Then
      expect(key).toBe('app:cache:v2:user:123:profile');
    });

    it('should support custom separators', () => {
      // Given/When
      const key = KeyBuilder.create({ separator: '/' }).segment('users').segment('active').segment('123').build();

      // Then
      expect(key).toBe('users/active/123');
    });

    it('should enforce lowercase when enabled', () => {
      // Given/When
      const key = KeyBuilder.create({ lowercase: true }).segment('User').segment('Profile').segment('Settings').build();

      // Then
      expect(key).toBe('user:profile:settings');
    });

    it('should allow invalid chars when validation disabled', () => {
      // Given/When
      const key = KeyBuilder.create({ validate: false }).segment('a:b').segment('c{d}').segment('e f').build();

      // Then
      expect(key).toBe('a:b:c{d}:e f');
    });
  });

  describe('validation edge cases', () => {
    it('should throw for key starting with separator', () => {
      // Given/When/Then
      try {
        KeyBuilder.fromTemplate(':user:123', {});
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw for key ending with separator', () => {
      // Given/When/Then
      try {
        KeyBuilder.fromTemplate('user:123:', {});
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw for consecutive separators', () => {
      // Given/When/Then
      try {
        KeyBuilder.fromTemplate('user::123', {});
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });
  });
});
