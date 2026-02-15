import { describe, it, expect } from 'vitest';
import { TagTemplate } from '../../src/invalidation/domain/value-objects/tag-template.vo';

describe('TagTemplate', () => {
  describe('create', () => {
    it('should create template from string', () => {
      // Given
      const templateStr = 'user:{userId}';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template).toBeInstanceOf(TagTemplate);
      expect(template.toString()).toBe('user:{userId}');
    });

    it('should create template without placeholders', () => {
      // Given
      const templateStr = 'users';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.toString()).toBe('users');
      expect(template.hasPlaceholders()).toBe(false);
    });

    it('should trim whitespace from template', () => {
      // Given
      const templateStr = '  user:{userId}  ';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.toString()).toBe('user:{userId}');
    });

    it('should throw error for empty template', () => {
      // Given
      const templateStr = '';

      // When/Then
      try {
        TagTemplate.create(templateStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/cannot be empty/);
      }
    });

    it('should throw error for whitespace-only template', () => {
      // Given
      const templateStr = '   ';

      // When/Then
      try {
        TagTemplate.create(templateStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/cannot be empty/);
      }
    });

    it('should extract single placeholder', () => {
      // Given
      const templateStr = 'user:{userId}';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.getPlaceholders()).toEqual(['userId']);
    });

    it('should extract multiple placeholders', () => {
      // Given
      const templateStr = 'user:{userId}:tenant:{tenantId}';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.getPlaceholders()).toEqual(['userId', 'tenantId']);
    });

    it('should extract nested placeholder', () => {
      // Given
      const templateStr = 'user:{payload.userId}';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.getPlaceholders()).toEqual(['payload.userId']);
    });

    it('should handle template with no placeholders', () => {
      // Given
      const templateStr = 'static-tag';

      // When
      const template = TagTemplate.create(templateStr);

      // Then
      expect(template.getPlaceholders()).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('should resolve simple placeholder', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = { userId: '123' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:123');
    });

    it('should resolve multiple placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{userId}:tenant:{tenantId}');
      const payload = { userId: '123', tenantId: '456' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:123:tenant:456');
    });

    it('should resolve nested placeholder', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: { id: '123' } };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:123');
    });

    it('should resolve deep nested placeholder', () => {
      // Given
      const template = TagTemplate.create('order:{order.user.id}');
      const payload = { order: { user: { id: '789' } } };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('order:789');
    });

    it('should keep unresolved placeholder when value not found', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = {};

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should keep unresolved placeholder when nested value not found', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: {} };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{user.id}');
    });

    it('should resolve template without placeholders', () => {
      // Given
      const template = TagTemplate.create('static-tag');
      const payload = { userId: '123' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('static-tag');
    });

    it('should convert numeric value to string', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = { userId: 123 };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:123');
    });

    it('should convert boolean value to string', () => {
      // Given
      const template = TagTemplate.create('active:{isActive}');
      const payload = { isActive: true };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('active:true');
    });

    it('should keep placeholder when value is null', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = { userId: null };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should keep placeholder when value is undefined', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = { userId: undefined };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should keep placeholder when nested path is null', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: null };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{user.id}');
    });

    it('should keep placeholder when nested path is undefined', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: undefined };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{user.id}');
    });

    it('should keep placeholder when parent is not an object', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: 'string-value' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{user.id}');
    });

    it('should keep placeholder when parent is a number', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');
      const payload = { user: 123 };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{user.id}');
    });

    it('should handle payload as null', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = null;

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should handle payload as undefined', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = undefined;

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should handle empty object payload', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');
      const payload = {};

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should resolve mixed static and dynamic parts', () => {
      // Given
      const template = TagTemplate.create('tenant:123:user:{userId}');
      const payload = { userId: '456' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('tenant:123:user:456');
    });

    it('should resolve multiple same placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{id}:profile:{id}');
      const payload = { id: '789' };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:789:profile:789');
    });

    it('should handle deeply nested null in path', () => {
      // Given
      const template = TagTemplate.create('user:{a.b.c.d}');
      const payload = { a: { b: null } };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{a.b.c.d}');
    });

    it('should handle deeply nested undefined in path', () => {
      // Given
      const template = TagTemplate.create('user:{a.b.c.d}');
      const payload = { a: { b: undefined } };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{a.b.c.d}');
    });

    it('should handle non-object in middle of nested path', () => {
      // Given
      const template = TagTemplate.create('user:{a.b.c}');
      const payload = { a: { b: 123 } };

      // When
      const result = template.resolve(payload);

      // Then
      expect(result).toBe('user:{a.b.c}');
    });
  });

  describe('toString', () => {
    it('should return template string', () => {
      // Given
      const templateStr = 'user:{userId}';
      const template = TagTemplate.create(templateStr);

      // When
      const result = template.toString();

      // Then
      expect(result).toBe('user:{userId}');
    });

    it('should return template without placeholders', () => {
      // Given
      const templateStr = 'static-tag';
      const template = TagTemplate.create(templateStr);

      // When
      const result = template.toString();

      // Then
      expect(result).toBe('static-tag');
    });
  });

  describe('getPlaceholders', () => {
    it('should return array of placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{userId}:tenant:{tenantId}');

      // When
      const placeholders = template.getPlaceholders();

      // Then
      expect(placeholders).toEqual(['userId', 'tenantId']);
    });

    it('should return empty array when no placeholders', () => {
      // Given
      const template = TagTemplate.create('static-tag');

      // When
      const placeholders = template.getPlaceholders();

      // Then
      expect(placeholders).toEqual([]);
    });

    it('should return copy of placeholders array', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');

      // When
      const placeholders1 = template.getPlaceholders();
      const placeholders2 = template.getPlaceholders();

      // Then
      expect(placeholders1).not.toBe(placeholders2);
      expect(placeholders1).toEqual(placeholders2);
    });

    it('should not allow modifying internal placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');

      // When
      const placeholders = template.getPlaceholders();
      placeholders.push('newPlaceholder');

      // Then
      expect(template.getPlaceholders()).toEqual(['userId']);
    });

    it('should return nested placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{user.id}');

      // When
      const placeholders = template.getPlaceholders();

      // Then
      expect(placeholders).toEqual(['user.id']);
    });
  });

  describe('hasPlaceholders', () => {
    it('should return true when template has placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{userId}');

      // When
      const result = template.hasPlaceholders();

      // Then
      expect(result).toBe(true);
    });

    it('should return false when template has no placeholders', () => {
      // Given
      const template = TagTemplate.create('static-tag');

      // When
      const result = template.hasPlaceholders();

      // Then
      expect(result).toBe(false);
    });

    it('should return true for multiple placeholders', () => {
      // Given
      const template = TagTemplate.create('user:{userId}:tenant:{tenantId}');

      // When
      const result = template.hasPlaceholders();

      // Then
      expect(result).toBe(true);
    });
  });
});
