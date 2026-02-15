import { describe, it, expect } from 'vitest';
import { CachePut, CACHE_PUT_METADATA_KEY, type ICachePutOptions } from '../../src/decorators/cache-put.decorator';
import { Reflector } from '@nestjs/core';

describe('CachePut decorator', () => {
  const reflector = new Reflector();

  describe('@CachePut', () => {
    it('should set metadata with basic options', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{id}',
        ttl: 3600,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id, name: 'Updated' };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata).toEqual(options);
      expect(metadata.key).toBe('user:{id}');
      expect(metadata.ttl).toBe(3600);
    });

    it('should set metadata with static tags', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{id}',
        tags: ['users', 'updated'],
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.tags).toEqual(['users', 'updated']);
    });

    it('should set metadata with dynamic tags function', () => {
      // Given
      const tagsFn = (id: string) => [`user:${id}`, 'users'];
      const options: ICachePutOptions = {
        key: 'user:{id}',
        tags: tagsFn,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.tags).toBe(tagsFn);
    });

    it('should set metadata with condition function', () => {
      // Given
      const condition = (id: string) => id !== 'admin';
      const options: ICachePutOptions = {
        key: 'user:{id}',
        condition,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.condition).toBe(condition);
    });

    it('should set metadata with custom key generator', () => {
      // Given
      const keyGenerator = (id: string, type: string) => `${type}:${id}`;
      const options: ICachePutOptions = {
        key: 'fallback',
        keyGenerator,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string, type: string) {
          return { id, type };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.keyGenerator).toBe(keyGenerator);
    });

    it('should set metadata with namespace', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{id}',
        namespace: 'myapp',
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.namespace).toBe('myapp');
    });

    it('should set metadata with cacheNullValues flag', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{id}',
        cacheNullValues: true,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return null;
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.cacheNullValues).toBe(true);
    });

    it('should set metadata with nested property key', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{user.id}',
      };

      class TestClass {
        @CachePut(options)
        createUser(user: { id: string }) {
          return user;
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.createUser);

      // Then
      expect(metadata.key).toBe('user:{user.id}');
    });

    it('should set metadata with all options', () => {
      // Given
      const options: ICachePutOptions = {
        key: 'user:{id}',
        ttl: 1800,
        tags: ['users'],
        condition: () => true,
        keyGenerator: () => 'custom',
        namespace: 'app',
        cacheNullValues: false,
      };

      class TestClass {
        @CachePut(options)
        updateUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata).toEqual(options);
    });

    it('should work with multiple decorated methods', () => {
      // Given
      class TestClass {
        @CachePut({ key: 'user:{id}', ttl: 3600 })
        updateUser(id: string) {
          return { id };
        }

        @CachePut({ key: 'post:{id}', ttl: 1800 })
        updatePost(id: string) {
          return { id };
        }
      }

      // When
      const userMeta = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updateUser);
      const postMeta = reflector.get(CACHE_PUT_METADATA_KEY, TestClass.prototype.updatePost);

      // Then
      expect(userMeta.key).toBe('user:{id}');
      expect(userMeta.ttl).toBe(3600);
      expect(postMeta.key).toBe('post:{id}');
      expect(postMeta.ttl).toBe(1800);
    });
  });

  describe('CACHE_PUT_METADATA_KEY', () => {
    it('should have correct value', () => {
      // Given/When/Then
      expect(CACHE_PUT_METADATA_KEY).toBe('cache:put');
    });
  });
});
