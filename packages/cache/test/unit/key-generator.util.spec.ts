import { describe, it, expect } from 'vitest';
import { getParameterNames, getNestedValue, generateKey, generateKeys, evaluateTags, evaluateCondition } from '../../src/decorators/key-generator.util';

describe('key-generator.util', () => {
  describe('getParameterNames', () => {
    it('should extract parameter names from function', () => {
      // Given
      function testFn(id: string, name: string) {
        return { id, name };
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id', 'name']);
    });

    it('should handle function with no parameters', () => {
      // Given
      function testFn() {
        return 'test';
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual([]);
    });

    it('should handle function with default parameters', () => {
      // Given
      function testFn(id: string, count = 10) {
        return { id, count };
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id', 'count']);
    });

    it('should handle arrow function', () => {
      // Given
      const testFn = (id: string, name: string) => ({ id, name });

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id', 'name']);
    });

    it('should handle function with comments in signature', () => {
      // Given
      function testFn(/* comment */ id: string, name: string /* another */) {
        return { id, name };
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id', 'name']);
    });

    it('should handle single parameter', () => {
      // Given
      function testFn(id: string) {
        return id;
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id']);
    });

    it('should filter out empty parameters', () => {
      // Given
      function testFn(id: string) {
        return id;
      }

      // When
      const result = getParameterNames(testFn);

      // Then
      expect(result).toEqual(['id']);
    });
  });

  describe('getNestedValue', () => {
    it('should get simple property', () => {
      // Given
      const obj = { id: '123', name: 'John' };

      // When
      const result = getNestedValue(obj, 'id');

      // Then
      expect(result).toBe('123');
    });

    it('should get nested property', () => {
      // Given
      const obj = { user: { id: '456', name: 'Jane' } };

      // When
      const result = getNestedValue(obj, 'user.id');

      // Then
      expect(result).toBe('456');
    });

    it('should get deeply nested property', () => {
      // Given
      const obj = { data: { user: { profile: { email: 'test@example.com' } } } };

      // When
      const result = getNestedValue(obj, 'data.user.profile.email');

      // Then
      expect(result).toBe('test@example.com');
    });

    it('should return undefined for non-existent property', () => {
      // Given
      const obj = { id: '123' };

      // When
      const result = getNestedValue(obj, 'name');

      // Then
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent nested property', () => {
      // Given
      const obj = { user: { id: '123' } };

      // When
      const result = getNestedValue(obj, 'user.profile.email');

      // Then
      expect(result).toBeUndefined();
    });

    it('should return undefined when object is null', () => {
      // Given/When
      const result = getNestedValue(null, 'id');

      // Then
      expect(result).toBeUndefined();
    });

    it('should return undefined when object is undefined', () => {
      // Given/When
      const result = getNestedValue(undefined, 'id');

      // Then
      expect(result).toBeUndefined();
    });

    it('should return undefined when object is not an object', () => {
      // Given/When
      const result = getNestedValue('string', 'id');

      // Then
      expect(result).toBeUndefined();
    });

    it('should return undefined when intermediate value is null', () => {
      // Given
      const obj = { user: null };

      // When
      const result = getNestedValue(obj, 'user.id');

      // Then
      expect(result).toBeUndefined();
    });

    it('should handle numeric properties', () => {
      // Given
      const obj = { items: ['first', 'second', 'third'] };

      // When
      const result = getNestedValue(obj, 'items.1');

      // Then
      expect(result).toBe('second');
    });
  });

  describe('generateKey', () => {
    it('should generate key from template with single parameter', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];

      // When
      const result = generateKey('user:{id}', testFn, args);

      // Then
      expect(result).toBe('user:123');
    });

    it('should generate key with multiple parameters', () => {
      // Given
      function testFn(userId: string, postId: string) {
        return { userId, postId };
      }
      const args = ['user-1', 'post-2'];

      // When
      const result = generateKey('user:{userId}:post:{postId}', testFn, args);

      // Then
      expect(result).toBe('user:user-1:post:post-2');
    });

    it('should generate key with nested property', () => {
      // Given
      function testFn(user: { id: string; name: string }) {
        return user;
      }
      const args = [{ id: '789', name: 'Alice' }];

      // When
      const result = generateKey('user:{user.id}', testFn, args);

      // Then
      expect(result).toBe('user:789');
    });

    it('should generate key with namespace', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];

      // When
      const result = generateKey('user:{id}', testFn, args, 'app');

      // Then
      expect(result).toBe('app:user:123');
    });

    it('should return template without placeholders as-is', () => {
      // Given
      function testFn() {
        return 'test';
      }
      const args = [];

      // When
      const result = generateKey('static-key', testFn, args);

      // Then
      expect(result).toBe('static-key');
    });

    it('should return template with namespace when no placeholders', () => {
      // Given
      function testFn() {
        return 'test';
      }
      const args = [];

      // When
      const result = generateKey('static-key', testFn, args, 'app');

      // Then
      expect(result).toBe('app:static-key');
    });

    it('should throw CacheKeyError when parameter not found', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];

      // When/Then
      try {
        generateKey('user:{name}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when parameter is null', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = [null];

      // When/Then
      try {
        generateKey('user:{id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when parameter is undefined', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = [undefined];

      // When/Then
      try {
        generateKey('user:{id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when nested property not found', () => {
      // Given
      function testFn(user: { name: string }) {
        return user;
      }
      const args = [{ name: 'John' }];

      // When/Then
      try {
        generateKey('user:{user.id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when nested property is undefined', () => {
      // Given
      function testFn(user: { id?: string }) {
        return user;
      }
      const args = [{ id: undefined }];

      // When/Then
      try {
        generateKey('user:{user.id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when root parameter for nested access not found', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];

      // When/Then
      try {
        generateKey('user:{user.id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when value contains colon', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['value:with:colons'];

      // When/Then
      try {
        generateKey('user:{id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError when value contains curly braces', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['value{with}braces'];

      // When/Then
      try {
        generateKey('user:{id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should throw CacheKeyError for invalid nested property path', () => {
      // Given
      function testFn(user: object) {
        return user;
      }
      const args = [{}];

      // When/Then
      try {
        generateKey('user:{.id}', testFn, args);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheKeyError/);
      }
    });

    it('should convert numeric value to string', () => {
      // Given
      function testFn(id: number) {
        return id;
      }
      const args = [123];

      // When
      const result = generateKey('user:{id}', testFn, args);

      // Then
      expect(result).toBe('user:123');
    });

    it('should convert boolean value to string', () => {
      // Given
      function testFn(active: boolean) {
        return active;
      }
      const args = [true];

      // When
      const result = generateKey('status:{active}', testFn, args);

      // Then
      expect(result).toBe('status:true');
    });

    it('should handle deeply nested properties', () => {
      // Given
      function testFn(data: any) {
        return data;
      }
      const args = [{ user: { profile: { id: '999' } } }];

      // When
      const result = generateKey('profile:{data.user.profile.id}', testFn, args);

      // Then
      expect(result).toBe('profile:999');
    });

    it('should handle multiple placeholders with same parameter', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];

      // When
      const result = generateKey('user:{id}:cache:{id}', testFn, args);

      // Then
      expect(result).toBe('user:123:cache:123');
    });
  });

  describe('generateKeys', () => {
    it('should generate multiple keys from templates', () => {
      // Given
      function testFn(id: string, name: string) {
        return { id, name };
      }
      const args = ['123', 'John'];
      const templates = ['user:{id}', 'user:name:{name}', 'user:{id}:{name}'];

      // When
      const result = generateKeys(templates, testFn, args);

      // Then
      expect(result).toEqual(['user:123', 'user:name:John', 'user:123:John']);
    });

    it('should generate keys with namespace', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];
      const templates = ['user:{id}', 'profile:{id}'];

      // When
      const result = generateKeys(templates, testFn, args, 'app');

      // Then
      expect(result).toEqual(['app:user:123', 'app:profile:123']);
    });

    it('should return empty array for empty templates', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];
      const templates: string[] = [];

      // When
      const result = generateKeys(templates, testFn, args);

      // Then
      expect(result).toEqual([]);
    });

    it('should handle single template', () => {
      // Given
      function testFn(id: string) {
        return id;
      }
      const args = ['123'];
      const templates = ['user:{id}'];

      // When
      const result = generateKeys(templates, testFn, args);

      // Then
      expect(result).toEqual(['user:123']);
    });
  });

  describe('evaluateTags', () => {
    it('should return static tags array', () => {
      // Given
      const tags = ['tag1', 'tag2', 'tag3'];
      const args = ['arg1', 'arg2'];

      // When
      const result = evaluateTags(tags, args);

      // Then
      expect(result).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should evaluate dynamic tags function', () => {
      // Given
      const tags = (id: string, type: string) => [`${type}:${id}`, `${type}-list`];
      const args = ['123', 'user'];

      // When
      const result = evaluateTags(tags, args);

      // Then
      expect(result).toEqual(['user:123', 'user-list']);
    });

    it('should return empty array when tags is undefined', () => {
      // Given
      const tags = undefined;
      const args = [];

      // When
      const result = evaluateTags(tags, args);

      // Then
      expect(result).toEqual([]);
    });

    it('should pass all arguments to tags function', () => {
      // Given
      const tags = (...args: any[]) => args.map((arg) => String(arg));
      const args = ['a', 'b', 'c'];

      // When
      const result = evaluateTags(tags, args);

      // Then
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle tags function returning empty array', () => {
      // Given
      const tags = () => [];
      const args = ['arg'];

      // When
      const result = evaluateTags(tags, args);

      // Then
      expect(result).toEqual([]);
    });
  });

  describe('evaluateCondition', () => {
    it('should return true when condition is undefined', () => {
      // Given
      const condition = undefined;
      const args = [];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(true);
    });

    it('should evaluate condition function returning true', () => {
      // Given
      const condition = (id: string) => id === '123';
      const args = ['123'];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(true);
    });

    it('should evaluate condition function returning false', () => {
      // Given
      const condition = (id: string) => id === '123';
      const args = ['456'];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(false);
    });

    it('should pass all arguments to condition function', () => {
      // Given
      const condition = (a: number, b: number) => a + b > 10;
      const args = [5, 8];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(true);
    });

    it('should handle complex condition logic', () => {
      // Given
      const condition = (user: { role: string; active: boolean }) => user.role === 'admin' && user.active;
      const args = [{ role: 'admin', active: true }];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for failing complex condition', () => {
      // Given
      const condition = (user: { role: string; active: boolean }) => user.role === 'admin' && user.active;
      const args = [{ role: 'user', active: true }];

      // When
      const result = evaluateCondition(condition, args);

      // Then
      expect(result).toBe(false);
    });
  });
});
