import { describe, it, expect } from 'vitest';
import { Cacheable, CACHEABLE_METADATA_KEY, type ICacheableOptions } from '../../src/decorators/cacheable.decorator';
import { Reflector } from '@nestjs/core';

describe('Cacheable decorator', () => {
  const reflector = new Reflector();

  describe('@Cacheable', () => {
    it('should set metadata with basic options', () => {
      // Given
      const options: ICacheableOptions = {
        key: 'user:{id}',
        ttl: 3600,
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id, name: 'Test' };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata).toEqual(options);
      expect(metadata.key).toBe('user:{id}');
      expect(metadata.ttl).toBe(3600);
    });

    it('should set metadata with static tags', () => {
      // Given
      const options: ICacheableOptions = {
        key: 'user:{id}',
        tags: ['users', 'active'],
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata.tags).toEqual(['users', 'active']);
    });

    it('should set metadata with dynamic tags function', () => {
      // Given
      const tagsFn = (id: string) => [`user:${id}`, 'users'];
      const options: ICacheableOptions = {
        key: 'user:{id}',
        tags: tagsFn,
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata.tags).toBe(tagsFn);
    });

    it('should set metadata with condition function', () => {
      // Given
      const condition = (id: string) => id !== 'admin';
      const options: ICacheableOptions = {
        key: 'user:{id}',
        condition,
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata.condition).toBe(condition);
    });

    it('should set metadata with custom key generator', () => {
      // Given
      const keyGenerator = (id: string, type: string) => `${type}:${id}`;
      const options: ICacheableOptions = {
        key: 'fallback',
        keyGenerator,
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string, type: string) {
          return { id, type };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata.keyGenerator).toBe(keyGenerator);
    });

    it('should set metadata with namespace', () => {
      // Given
      const options: ICacheableOptions = {
        key: 'user:{id}',
        namespace: 'myapp',
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata.namespace).toBe('myapp');
    });

    it('should set metadata with all options', () => {
      // Given
      const options: ICacheableOptions = {
        key: 'user:{id}',
        ttl: 1800,
        tags: ['users'],
        condition: () => true,
        keyGenerator: () => 'custom',
        namespace: 'app',
      };

      class TestClass {
        @Cacheable(options)
        getUser(id: string) {
          return { id };
        }
      }

      // When
      const metadata = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);

      // Then
      expect(metadata).toEqual(options);
    });

    it('should work with multiple decorated methods', () => {
      // Given
      class TestClass {
        @Cacheable({ key: 'user:{id}', ttl: 3600 })
        getUser(id: string) {
          return { id };
        }

        @Cacheable({ key: 'post:{id}', ttl: 1800 })
        getPost(id: string) {
          return { id };
        }
      }

      // When
      const userMeta = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getUser);
      const postMeta = reflector.get(CACHEABLE_METADATA_KEY, TestClass.prototype.getPost);

      // Then
      expect(userMeta.key).toBe('user:{id}');
      expect(userMeta.ttl).toBe(3600);
      expect(postMeta.key).toBe('post:{id}');
      expect(postMeta.ttl).toBe(1800);
    });
  });

  describe('CACHEABLE_METADATA_KEY', () => {
    it('should have correct value', () => {
      // Given/When/Then
      expect(CACHEABLE_METADATA_KEY).toBe('cache:cacheable');
    });
  });
});
