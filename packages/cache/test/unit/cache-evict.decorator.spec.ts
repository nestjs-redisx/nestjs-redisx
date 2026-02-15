import { describe, it, expect } from 'vitest';
import { CacheEvict, CACHE_EVICT_METADATA_KEY, type ICacheEvictOptions } from '../../src/decorators/cache-evict.decorator';
import { Reflector } from '@nestjs/core';

describe('CacheEvict decorator', () => {
  const reflector = new Reflector();

  describe('@CacheEvict', () => {
    it('should set metadata with empty options', () => {
      // Given
      class TestClass {
        @CacheEvict()
        deleteUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);

      // Then
      expect(metadata).toEqual({});
    });

    it('should set metadata with keys', () => {
      // Given
      const options: ICacheEvictOptions = {
        keys: ['user:{id}', 'user:{id}:profile'],
      };

      class TestClass {
        @CacheEvict(options)
        deleteUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);

      // Then
      expect(metadata.keys).toEqual(['user:{id}', 'user:{id}:profile']);
    });

    it('should set metadata with tags', () => {
      // Given
      const options: ICacheEvictOptions = {
        tags: ['users', 'active'],
      };

      class TestClass {
        @CacheEvict(options)
        updateUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.tags).toEqual(['users', 'active']);
    });

    it('should set metadata with allEntries flag', () => {
      // Given
      const options: ICacheEvictOptions = {
        allEntries: true,
      };

      class TestClass {
        @CacheEvict(options)
        clearCache() {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.clearCache);

      // Then
      expect(metadata.allEntries).toBe(true);
    });

    it('should set metadata with beforeInvocation flag', () => {
      // Given
      const options: ICacheEvictOptions = {
        keys: ['user:{id}'],
        beforeInvocation: true,
      };

      class TestClass {
        @CacheEvict(options)
        updateUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata.beforeInvocation).toBe(true);
    });

    it('should set metadata with condition function', () => {
      // Given
      const condition = (id: string) => id !== 'admin';
      const options: ICacheEvictOptions = {
        keys: ['user:{id}'],
        condition,
      };

      class TestClass {
        @CacheEvict(options)
        deleteUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);

      // Then
      expect(metadata.condition).toBe(condition);
    });

    it('should set metadata with custom key generator', () => {
      // Given
      const keyGenerator = (id: string) => [`user:${id}`, `profile:${id}`];
      const options: ICacheEvictOptions = {
        keyGenerator,
      };

      class TestClass {
        @CacheEvict(options)
        deleteUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);

      // Then
      expect(metadata.keyGenerator).toBe(keyGenerator);
    });

    it('should set metadata with namespace', () => {
      // Given
      const options: ICacheEvictOptions = {
        keys: ['user:{id}'],
        namespace: 'myapp',
      };

      class TestClass {
        @CacheEvict(options)
        deleteUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);

      // Then
      expect(metadata.namespace).toBe('myapp');
    });

    it('should set metadata with wildcard keys', () => {
      // Given
      const options: ICacheEvictOptions = {
        keys: ['user:{userId}:posts:*'],
      };

      class TestClass {
        @CacheEvict(options)
        deleteUserPosts(userId: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUserPosts);

      // Then
      expect(metadata.keys).toEqual(['user:{userId}:posts:*']);
    });

    it('should set metadata with all options', () => {
      // Given
      const options: ICacheEvictOptions = {
        keys: ['user:{id}'],
        tags: ['users'],
        beforeInvocation: false,
        condition: () => true,
        keyGenerator: () => ['key1'],
        namespace: 'app',
      };

      class TestClass {
        @CacheEvict(options)
        updateUser(id: string) {
          return true;
        }
      }

      // When
      const metadata = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.updateUser);

      // Then
      expect(metadata).toEqual(options);
    });

    it('should work with multiple decorated methods', () => {
      // Given
      class TestClass {
        @CacheEvict({ keys: ['user:{id}'] })
        deleteUser(id: string) {
          return true;
        }

        @CacheEvict({ allEntries: true })
        clearAll() {
          return true;
        }
      }

      // When
      const deleteMeta = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.deleteUser);
      const clearMeta = reflector.get(CACHE_EVICT_METADATA_KEY, TestClass.prototype.clearAll);

      // Then
      expect(deleteMeta.keys).toEqual(['user:{id}']);
      expect(clearMeta.allEntries).toBe(true);
    });
  });

  describe('CACHE_EVICT_METADATA_KEY', () => {
    it('should have correct value', () => {
      // Given/When/Then
      expect(CACHE_EVICT_METADATA_KEY).toBe('cache:evict');
    });
  });
});
