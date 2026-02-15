import { describe, it, expect } from 'vitest';
import { EventPattern } from '../../src/invalidation/domain/value-objects/event-pattern.vo';

describe('EventPattern', () => {
  describe('create', () => {
    it('should create pattern from string', () => {
      // Given
      const patternStr = 'user.updated';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern).toBeInstanceOf(EventPattern);
      expect(pattern.toString()).toBe('user.updated');
    });

    it('should create pattern with wildcard', () => {
      // Given
      const patternStr = 'user.*';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user.*');
    });

    it('should create pattern with hash wildcard', () => {
      // Given
      const patternStr = 'user.#';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user.#');
    });

    it('should trim whitespace from pattern', () => {
      // Given
      const patternStr = '  user.updated  ';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user.updated');
    });

    it('should throw error for empty pattern', () => {
      // Given
      const patternStr = '';

      // When/Then
      try {
        EventPattern.create(patternStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/cannot be empty/);
      }
    });

    it('should throw error for whitespace-only pattern', () => {
      // Given
      const patternStr = '   ';

      // When/Then
      try {
        EventPattern.create(patternStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/cannot be empty/);
      }
    });

    it('should throw error for pattern with invalid characters', () => {
      // Given
      const patternStr = 'user@updated';

      // When/Then
      try {
        EventPattern.create(patternStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/Invalid event pattern/);
      }
    });

    it('should throw error for pattern with spaces', () => {
      // Given
      const patternStr = 'user updated';

      // When/Then
      try {
        EventPattern.create(patternStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/Invalid event pattern/);
      }
    });

    it('should throw error for pattern with special chars', () => {
      // Given
      const patternStr = 'user.updated!';

      // When/Then
      try {
        EventPattern.create(patternStr);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/CacheError/);
        expect((error as Error).message).toMatch(/Invalid event pattern/);
      }
    });

    it('should accept pattern with dashes', () => {
      // Given
      const patternStr = 'user-service.updated';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user-service.updated');
    });

    it('should accept pattern with underscores', () => {
      // Given
      const patternStr = 'user_service.updated';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user_service.updated');
    });

    it('should accept pattern with numbers', () => {
      // Given
      const patternStr = 'user123.updated456';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('user123.updated456');
    });

    it('should accept pattern with mixed case', () => {
      // Given
      const patternStr = 'User.Updated';

      // When
      const pattern = EventPattern.create(patternStr);

      // Then
      expect(pattern.toString()).toBe('User.Updated');
    });
  });

  describe('matches', () => {
    it('should match exact event', () => {
      // Given
      const pattern = EventPattern.create('user.updated');

      // When/Then
      expect(pattern.matches('user.updated')).toBe(true);
    });

    it('should not match different event', () => {
      // Given
      const pattern = EventPattern.create('user.updated');

      // When/Then
      expect(pattern.matches('user.created')).toBe(false);
    });

    it('should match with single wildcard', () => {
      // Given
      const pattern = EventPattern.create('user.*');

      // When/Then
      expect(pattern.matches('user.updated')).toBe(true);
      expect(pattern.matches('user.created')).toBe(true);
      expect(pattern.matches('user.deleted')).toBe(true);
    });

    it('should not match multiple segments with single wildcard', () => {
      // Given
      const pattern = EventPattern.create('user.*');

      // When/Then
      expect(pattern.matches('user.profile.updated')).toBe(false);
    });

    it('should match with hash wildcard for multiple segments', () => {
      // Given
      const pattern = EventPattern.create('user.#');

      // When/Then
      expect(pattern.matches('user.updated')).toBe(true);
      expect(pattern.matches('user.profile.updated')).toBe(true);
      expect(pattern.matches('user.profile.settings.changed')).toBe(true);
    });

    it('should match zero segments with hash wildcard', () => {
      // Given
      const pattern = EventPattern.create('user.#');

      // When/Then
      expect(pattern.matches('user')).toBe(true);
    });

    it('should not match different namespace with wildcard', () => {
      // Given
      const pattern = EventPattern.create('user.*');

      // When/Then
      expect(pattern.matches('post.updated')).toBe(false);
    });

    it('should match with wildcard in middle', () => {
      // Given
      const pattern = EventPattern.create('user.*.updated');

      // When/Then
      expect(pattern.matches('user.profile.updated')).toBe(true);
      expect(pattern.matches('user.settings.updated')).toBe(true);
      expect(pattern.matches('user.updated')).toBe(false);
    });

    it('should match with hash in middle', () => {
      // Given
      const pattern = EventPattern.create('user.#.updated');

      // When/Then
      expect(pattern.matches('user.profile.updated')).toBe(true);
      expect(pattern.matches('user.profile.settings.updated')).toBe(true);
      // Note: user.updated won't match because dots are required around # when it's in the middle
      expect(pattern.matches('user.updated')).toBe(false);
    });

    it('should match with multiple wildcards', () => {
      // Given
      const pattern = EventPattern.create('*.*.updated');

      // When/Then
      expect(pattern.matches('user.profile.updated')).toBe(true);
      expect(pattern.matches('order.item.updated')).toBe(true);
      expect(pattern.matches('user.updated')).toBe(false);
    });

    it('should be case-sensitive', () => {
      // Given
      const pattern = EventPattern.create('user.updated');

      // When/Then
      expect(pattern.matches('User.Updated')).toBe(false);
      expect(pattern.matches('user.updated')).toBe(true);
    });

    it('should match patterns with dashes', () => {
      // Given
      const pattern = EventPattern.create('user-service.updated');

      // When/Then
      expect(pattern.matches('user-service.updated')).toBe(true);
      expect(pattern.matches('userservice.updated')).toBe(false);
    });

    it('should match patterns with underscores', () => {
      // Given
      const pattern = EventPattern.create('user_service.updated');

      // When/Then
      expect(pattern.matches('user_service.updated')).toBe(true);
      expect(pattern.matches('user-service.updated')).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return pattern string', () => {
      // Given
      const patternStr = 'user.updated';
      const pattern = EventPattern.create(patternStr);

      // When
      const result = pattern.toString();

      // Then
      expect(result).toBe('user.updated');
    });

    it('should return pattern with wildcard', () => {
      // Given
      const patternStr = 'user.*';
      const pattern = EventPattern.create(patternStr);

      // When
      const result = pattern.toString();

      // Then
      expect(result).toBe('user.*');
    });
  });

  describe('equals', () => {
    it('should return true for same pattern', () => {
      // Given
      const pattern1 = EventPattern.create('user.updated');
      const pattern2 = EventPattern.create('user.updated');

      // When
      const result = pattern1.equals(pattern2);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for different patterns', () => {
      // Given
      const pattern1 = EventPattern.create('user.updated');
      const pattern2 = EventPattern.create('user.created');

      // When
      const result = pattern1.equals(pattern2);

      // Then
      expect(result).toBe(false);
    });

    it('should return true for same pattern with whitespace', () => {
      // Given
      const pattern1 = EventPattern.create('user.updated');
      const pattern2 = EventPattern.create('  user.updated  ');

      // When
      const result = pattern1.equals(pattern2);

      // Then
      expect(result).toBe(true);
    });

    it('should be case-sensitive', () => {
      // Given
      const pattern1 = EventPattern.create('user.updated');
      const pattern2 = EventPattern.create('User.Updated');

      // When
      const result = pattern1.equals(pattern2);

      // Then
      expect(result).toBe(false);
    });
  });
});
