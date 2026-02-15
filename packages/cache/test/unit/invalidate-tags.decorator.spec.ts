import { describe, it, expect } from 'vitest';
import { InvalidateTags, type IInvalidateTagsOptions } from '../../src/cache/api/decorators/invalidate-tags.decorator';
import { INVALIDATE_TAGS_KEY } from '../../src/shared/constants';

describe('@InvalidateTags decorator', () => {
  class TestClass {
    @InvalidateTags({ tags: ['users'] })
    async defaultMethod(): Promise<void> {
      // No-op
    }

    @InvalidateTags({ tags: ['tag1', 'tag2'], when: 'before' })
    async methodWithBefore(): Promise<void> {
      // No-op
    }

    @InvalidateTags({ tags: ['tag1', 'tag2'], when: 'after' })
    async methodWithAfter(): Promise<void> {
      // No-op
    }

    @InvalidateTags({ tags: (id: string) => [`user:${id}`, 'users'] })
    async methodWithFunctionTags(id: string): Promise<void> {
      // No-op
    }

    @InvalidateTags({
      tags: (id: string, status: string) => [`user:${id}`, `status:${status}`, 'users'],
      when: 'after',
    })
    async complexMethod(id: string, status: string): Promise<void> {
      // No-op
    }
  }

  describe('decorator metadata', () => {
    it('should set metadata for default options', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'defaultMethod');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.tags).toEqual(['users']);
    });

    it('should set metadata with when=before', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithBefore');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.tags).toEqual(['tag1', 'tag2']);
      expect(metadata.when).toBe('before');
    });

    it('should set metadata with when=after', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithAfter');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.tags).toEqual(['tag1', 'tag2']);
      expect(metadata.when).toBe('after');
    });

    it('should set metadata with function tags', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'methodWithFunctionTags');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(typeof metadata.tags).toBe('function');

      if (typeof metadata.tags === 'function') {
        const result = metadata.tags('123');
        expect(result).toEqual(['user:123', 'users']);
      }
    });

    it('should set metadata with complex options', () => {
      // Given
      const descriptor = Object.getOwnPropertyDescriptor(TestClass.prototype, 'complexMethod');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata).toBeDefined();
      expect(typeof metadata.tags).toBe('function');
      expect(metadata.when).toBe('after');

      if (typeof metadata.tags === 'function') {
        const result = metadata.tags('123', 'active');
        expect(result).toEqual(['user:123', 'status:active', 'users']);
      }
    });
  });

  describe('decorator application', () => {
    it('should not modify method functionality', async () => {
      // Given
      const instance = new TestClass();

      // When/Then
      await expect(instance.defaultMethod()).resolves.toBeUndefined();
    });

    it('should preserve method signature', async () => {
      // Given
      const instance = new TestClass();

      // When/Then
      await expect(instance.complexMethod('123', 'active')).resolves.toBeUndefined();
    });
  });

  describe('static tags', () => {
    it('should support single tag', () => {
      // Given
      class SingleTagClass {
        @InvalidateTags({ tags: ['users'] })
        async method(): Promise<void> {}
      }

      const descriptor = Object.getOwnPropertyDescriptor(SingleTagClass.prototype, 'method');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata.tags).toEqual(['users']);
    });

    it('should support multiple tags', () => {
      // Given
      class MultiTagClass {
        @InvalidateTags({ tags: ['users', 'products', 'orders'] })
        async method(): Promise<void> {}
      }

      const descriptor = Object.getOwnPropertyDescriptor(MultiTagClass.prototype, 'method');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(metadata.tags).toEqual(['users', 'products', 'orders']);
    });
  });

  describe('function tags', () => {
    it('should support single argument function', () => {
      // Given
      class FunctionTagClass {
        @InvalidateTags({ tags: (id: number) => [`item:${id}`] })
        async method(id: number): Promise<void> {}
      }

      const descriptor = Object.getOwnPropertyDescriptor(FunctionTagClass.prototype, 'method');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(typeof metadata.tags).toBe('function');
      if (typeof metadata.tags === 'function') {
        expect(metadata.tags(42)).toEqual(['item:42']);
      }
    });

    it('should support multiple argument function', () => {
      // Given
      class MultiArgClass {
        @InvalidateTags({
          tags: (id: number, type: string) => [`${type}:${id}`, `${type}:all`],
        })
        async method(id: number, type: string): Promise<void> {}
      }

      const descriptor = Object.getOwnPropertyDescriptor(MultiArgClass.prototype, 'method');

      // When
      const metadata: IInvalidateTagsOptions = Reflect.getMetadata(INVALIDATE_TAGS_KEY, descriptor?.value);

      // Then
      expect(typeof metadata.tags).toBe('function');
      if (typeof metadata.tags === 'function') {
        expect(metadata.tags(42, 'product')).toEqual(['product:42', 'product:all']);
      }
    });
  });
});
