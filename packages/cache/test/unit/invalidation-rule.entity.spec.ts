import { describe, it, expect } from 'vitest';
import { InvalidationRule } from '../../src/invalidation/domain/entities/invalidation-rule.entity';

describe('InvalidationRule', () => {
  describe('create', () => {
    it('should create rule with event only', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // Then
      expect(rule).toBeInstanceOf(InvalidationRule);
      expect(rule.getEventPattern()).toBe('user.updated');
    });

    it('should create rule with tags', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users', 'active'],
      });

      // Then
      expect(rule.hasTags()).toBe(true);
      expect(rule.resolveTags({})).toEqual(['users', 'active']);
    });

    it('should create rule with keys', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:123', 'profile:123'],
      });

      // Then
      expect(rule.hasKeys()).toBe(true);
      expect(rule.resolveKeys({})).toEqual(['user:123', 'profile:123']);
    });

    it('should create rule with condition', () => {
      // Given/When
      const condition = (payload: any) => payload.active === true;
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition,
      });

      // Then
      expect(rule.hasCondition()).toBe(true);
    });

    it('should create rule with priority', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.updated',
        priority: 10,
      });

      // Then
      expect(rule.getPriority()).toBe(10);
    });

    it('should use default priority of 0', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // Then
      expect(rule.getPriority()).toBe(0);
    });

    it('should create rule with all options', () => {
      // Given/When
      const rule = InvalidationRule.create({
        event: 'user.*',
        tags: ['users'],
        keys: ['user:{id}'],
        condition: () => true,
        priority: 5,
      });

      // Then
      expect(rule.hasTags()).toBe(true);
      expect(rule.hasKeys()).toBe(true);
      expect(rule.hasCondition()).toBe(true);
      expect(rule.getPriority()).toBe(5);
    });
  });

  describe('matches', () => {
    it('should match exact event', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.matches('user.updated')).toBe(true);
    });

    it('should not match different event', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.matches('user.created')).toBe(false);
    });

    it('should match wildcard pattern', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.*',
      });

      // When/Then
      expect(rule.matches('user.updated')).toBe(true);
      expect(rule.matches('user.created')).toBe(true);
      expect(rule.matches('user.deleted')).toBe(true);
    });

    it('should not match different namespace with wildcard', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.*',
      });

      // When/Then
      expect(rule.matches('post.updated')).toBe(false);
    });
  });

  describe('testCondition', () => {
    it('should return true when no condition is set', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.testCondition({})).toBe(true);
      expect(rule.testCondition({ any: 'data' })).toBe(true);
    });

    it('should return true when condition passes', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition: (payload: any) => payload.active === true,
      });

      // When/Then
      expect(rule.testCondition({ active: true })).toBe(true);
    });

    it('should return false when condition fails', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition: (payload: any) => payload.active === true,
      });

      // When/Then
      expect(rule.testCondition({ active: false })).toBe(false);
    });

    it('should return false when condition throws error', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition: (payload: any) => {
          throw new Error('Condition error');
        },
      });

      // When/Then
      expect(rule.testCondition({})).toBe(false);
    });

    it('should handle complex condition logic', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition: (payload: any) => {
          return payload.type === 'premium' && payload.changes?.includes('email');
        },
      });

      // When/Then
      expect(
        rule.testCondition({
          type: 'premium',
          changes: ['email', 'name'],
        }),
      ).toBe(true);
      expect(
        rule.testCondition({
          type: 'free',
          changes: ['email'],
        }),
      ).toBe(false);
      expect(
        rule.testCondition({
          type: 'premium',
          changes: ['name'],
        }),
      ).toBe(false);
    });
  });

  describe('resolveTags', () => {
    it('should return empty array when no tags', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When
      const tags = rule.resolveTags({});

      // Then
      expect(tags).toEqual([]);
    });

    it('should resolve static tags', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users', 'active'],
      });

      // When
      const tags = rule.resolveTags({});

      // Then
      expect(tags).toEqual(['users', 'active']);
    });

    it('should resolve tag templates with payload', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['user:{id}', 'users'],
      });

      // When
      const tags = rule.resolveTags({ id: '123' });

      // Then
      expect(tags).toEqual(['user:123', 'users']);
    });

    it('should resolve multiple tag templates', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'order.updated',
        tags: ['user:{userId}', 'order:{orderId}'],
      });

      // When
      const tags = rule.resolveTags({ userId: 'u1', orderId: 'o1' });

      // Then
      expect(tags).toEqual(['user:u1', 'order:o1']);
    });
  });

  describe('resolveKeys', () => {
    it('should return empty array when no keys', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When
      const keys = rule.resolveKeys({});

      // Then
      expect(keys).toEqual([]);
    });

    it('should resolve static keys', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['cache:users', 'cache:active'],
      });

      // When
      const keys = rule.resolveKeys({});

      // Then
      expect(keys).toEqual(['cache:users', 'cache:active']);
    });

    it('should resolve key templates with payload', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:{id}', 'profile:{id}'],
      });

      // When
      const keys = rule.resolveKeys({ id: '456' });

      // Then
      expect(keys).toEqual(['user:456', 'profile:456']);
    });

    it('should resolve nested properties in templates', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'order.updated',
        keys: ['order:{order.id}', 'user:{order.userId}'],
      });

      // When
      const keys = rule.resolveKeys({
        order: { id: 'o1', userId: 'u1' },
      });

      // Then
      expect(keys).toEqual(['order:o1', 'user:u1']);
    });
  });

  describe('getPriority', () => {
    it('should return configured priority', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        priority: 15,
      });

      // When
      const priority = rule.getPriority();

      // Then
      expect(priority).toBe(15);
    });

    it('should return 0 for default priority', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When
      const priority = rule.getPriority();

      // Then
      expect(priority).toBe(0);
    });

    it('should handle negative priority', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        priority: -5,
      });

      // When
      const priority = rule.getPriority();

      // Then
      expect(priority).toBe(-5);
    });
  });

  describe('getEventPattern', () => {
    it('should return event pattern string', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When
      const pattern = rule.getEventPattern();

      // Then
      expect(pattern).toBe('user.updated');
    });

    it('should return wildcard pattern', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.*',
      });

      // When
      const pattern = rule.getEventPattern();

      // Then
      expect(pattern).toBe('user.*');
    });
  });

  describe('hasTags', () => {
    it('should return true when tags exist', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
      });

      // When/Then
      expect(rule.hasTags()).toBe(true);
    });

    it('should return false when no tags', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.hasTags()).toBe(false);
    });

    it('should return false when empty tags array', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: [],
      });

      // When/Then
      expect(rule.hasTags()).toBe(false);
    });
  });

  describe('hasKeys', () => {
    it('should return true when keys exist', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:123'],
      });

      // When/Then
      expect(rule.hasKeys()).toBe(true);
    });

    it('should return false when no keys', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.hasKeys()).toBe(false);
    });

    it('should return false when empty keys array', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: [],
      });

      // When/Then
      expect(rule.hasKeys()).toBe(false);
    });
  });

  describe('hasCondition', () => {
    it('should return true when condition exists', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        condition: () => true,
      });

      // When/Then
      expect(rule.hasCondition()).toBe(true);
    });

    it('should return false when no condition', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });

      // When/Then
      expect(rule.hasCondition()).toBe(false);
    });
  });
});
