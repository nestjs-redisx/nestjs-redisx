import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvalidationRegistryService } from '../../src/invalidation/application/services/invalidation-registry.service';
import { InvalidationRule } from '../../src/invalidation/domain/entities/invalidation-rule.entity';

describe('InvalidationRegistryService', () => {
  let service: InvalidationRegistryService;

  beforeEach(() => {
    service = new InvalidationRegistryService();
  });

  describe('register', () => {
    it('should register single rule', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
      });

      // When
      service.register(rule);

      // Then
      expect(service.getRules()).toHaveLength(1);
      expect(service.getRules()[0]).toBe(rule);
    });

    it('should sort rules by priority descending', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.updated',
        priority: 5,
      });
      const rule2 = InvalidationRule.create({
        event: 'user.created',
        priority: 10,
      });
      const rule3 = InvalidationRule.create({
        event: 'user.deleted',
        priority: 3,
      });

      // When
      service.register(rule1);
      service.register(rule2);
      service.register(rule3);

      // Then
      const rules = service.getRules();
      expect(rules[0]).toBe(rule2); // priority 10
      expect(rules[1]).toBe(rule1); // priority 5
      expect(rules[2]).toBe(rule3); // priority 3
    });

    it('should maintain sort order when registering rules with same priority', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.updated',
        priority: 5,
      });
      const rule2 = InvalidationRule.create({
        event: 'user.created',
        priority: 5,
      });

      // When
      service.register(rule1);
      service.register(rule2);

      // Then
      const rules = service.getRules();
      expect(rules).toHaveLength(2);
      expect(rules[0].getPriority()).toBe(5);
      expect(rules[1].getPriority()).toBe(5);
    });

    it('should handle rules with negative priority', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.updated',
        priority: -5,
      });
      const rule2 = InvalidationRule.create({
        event: 'user.created',
        priority: 0,
      });

      // When
      service.register(rule1);
      service.register(rule2);

      // Then
      const rules = service.getRules();
      expect(rules[0]).toBe(rule2); // priority 0
      expect(rules[1]).toBe(rule1); // priority -5
    });
  });

  describe('registerMany', () => {
    it('should register multiple rules', () => {
      // Given
      const rules = [InvalidationRule.create({ event: 'user.updated', tags: ['users'] }), InvalidationRule.create({ event: 'user.created', tags: ['users'] }), InvalidationRule.create({ event: 'user.deleted', tags: ['users'] })];

      // When
      service.registerMany(rules);

      // Then
      expect(service.getRules()).toHaveLength(3);
    });

    it('should sort all rules by priority', () => {
      // Given
      const rules = [InvalidationRule.create({ event: 'user.updated', priority: 5 }), InvalidationRule.create({ event: 'user.created', priority: 10 }), InvalidationRule.create({ event: 'user.deleted', priority: 3 })];

      // When
      service.registerMany(rules);

      // Then
      const registered = service.getRules();
      expect(registered[0].getPriority()).toBe(10);
      expect(registered[1].getPriority()).toBe(5);
      expect(registered[2].getPriority()).toBe(3);
    });

    it('should handle empty array', () => {
      // Given
      const rules: InvalidationRule[] = [];

      // When
      service.registerMany(rules);

      // Then
      expect(service.getRules()).toHaveLength(0);
    });

    it('should add to existing rules', () => {
      // Given
      const existingRule = InvalidationRule.create({
        event: 'user.updated',
        priority: 5,
      });
      service.register(existingRule);

      const newRules = [InvalidationRule.create({ event: 'post.created', priority: 10 }), InvalidationRule.create({ event: 'post.deleted', priority: 3 })];

      // When
      service.registerMany(newRules);

      // Then
      expect(service.getRules()).toHaveLength(3);
      expect(service.getRules()[0].getPriority()).toBe(10);
    });
  });

  describe('unregister', () => {
    it('should remove rule by event pattern', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.updated' });
      const rule2 = InvalidationRule.create({ event: 'user.created' });
      service.register(rule1);
      service.register(rule2);

      // When
      service.unregister('user.updated');

      // Then
      const rules = service.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toBe(rule2);
    });

    it('should remove all rules with matching event pattern', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.updated', tags: ['users'] });
      const rule2 = InvalidationRule.create({ event: 'user.updated', tags: ['active'] });
      const rule3 = InvalidationRule.create({ event: 'user.created', tags: ['users'] });
      service.registerMany([rule1, rule2, rule3]);

      // When
      service.unregister('user.updated');

      // Then
      const rules = service.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toBe(rule3);
    });

    it('should do nothing when event not found', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.updated' });
      service.register(rule);

      // When
      service.unregister('user.deleted');

      // Then
      expect(service.getRules()).toHaveLength(1);
    });

    it('should handle unregister on empty registry', () => {
      // Given/When
      service.unregister('user.updated');

      // Then
      expect(service.getRules()).toHaveLength(0);
    });

    it('should not remove rules with partial match', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.updated' });
      const rule2 = InvalidationRule.create({ event: 'user.*' });
      service.registerMany([rule1, rule2]);

      // When
      service.unregister('user.updated');

      // Then
      const rules = service.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toBe(rule2);
    });
  });

  describe('findRules', () => {
    it('should find exact matching rule', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.updated' });
      service.register(rule);

      // When
      const found = service.findRules('user.updated');

      // Then
      expect(found).toHaveLength(1);
      expect(found[0]).toBe(rule);
    });

    it('should find wildcard matching rules', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.*' });
      service.register(rule);

      // When
      const found = service.findRules('user.updated');

      // Then
      expect(found).toHaveLength(1);
      expect(found[0]).toBe(rule);
    });

    it('should return multiple matching rules', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.*' });
      const rule2 = InvalidationRule.create({ event: 'user.updated' });
      const rule3 = InvalidationRule.create({ event: 'post.updated' });
      service.registerMany([rule1, rule2, rule3]);

      // When
      const found = service.findRules('user.updated');

      // Then
      expect(found).toHaveLength(2);
      expect(found).toContain(rule1);
      expect(found).toContain(rule2);
    });

    it('should return empty array when no match', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.updated' });
      service.register(rule);

      // When
      const found = service.findRules('post.created');

      // Then
      expect(found).toHaveLength(0);
    });

    it('should return empty array for empty registry', () => {
      // Given/When
      const found = service.findRules('user.updated');

      // Then
      expect(found).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('should resolve tags from matching rules', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users', 'active'],
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.tags).toEqual(['users', 'active']);
      expect(result.keys).toEqual([]);
      expect(result.matchedRules).toHaveLength(1);
    });

    it('should resolve keys from matching rules', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:123', 'profile:123'],
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.keys).toEqual(['user:123', 'profile:123']);
      expect(result.tags).toEqual([]);
      expect(result.matchedRules).toHaveLength(1);
    });

    it('should resolve tag templates with payload', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['user:{id}', 'users'],
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', { id: '123' });

      // Then
      expect(result.tags).toEqual(['user:123', 'users']);
    });

    it('should resolve key templates with payload', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:{id}', 'profile:{id}'],
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', { id: '456' });

      // Then
      expect(result.keys).toEqual(['user:456', 'profile:456']);
    });

    it('should skip rules with failing conditions', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.updated',
        tags: ['active'],
        condition: (payload: any) => payload.active === true,
      });
      const rule2 = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
      });
      service.registerMany([rule1, rule2]);

      // When
      const result = service.resolve('user.updated', { active: false });

      // Then
      expect(result.tags).toEqual(['users']);
      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0]).toBe(rule2);
    });

    it('should include rules with passing conditions', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['premium'],
        condition: (payload: any) => payload.type === 'premium',
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', { type: 'premium' });

      // Then
      expect(result.tags).toEqual(['premium']);
      expect(result.matchedRules).toHaveLength(1);
    });

    it('should deduplicate tags from multiple rules', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.*',
        tags: ['users'],
      });
      const rule2 = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users', 'active'],
      });
      service.registerMany([rule1, rule2]);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.tags.sort()).toEqual(['active', 'users']);
      expect(result.matchedRules).toHaveLength(2);
    });

    it('should deduplicate keys from multiple rules', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.*',
        keys: ['cache:users'],
      });
      const rule2 = InvalidationRule.create({
        event: 'user.updated',
        keys: ['cache:users', 'cache:active'],
      });
      service.registerMany([rule1, rule2]);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.keys.sort()).toEqual(['cache:active', 'cache:users']);
    });

    it('should skip tags with unresolved placeholders', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['user:{id}', 'users'],
      });
      service.register(rule);

      // When - missing 'id' in payload
      const result = service.resolve('user.updated', {});

      // Then - only 'users' should be included
      expect(result.tags).toEqual(['users']);
    });

    it('should skip keys with unresolved placeholders', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        keys: ['user:{id}', 'cache:users'],
      });
      service.register(rule);

      // When - missing 'id' in payload
      const result = service.resolve('user.updated', {});

      // Then - only 'cache:users' should be included
      expect(result.keys).toEqual(['cache:users']);
    });

    it('should resolve tags from multiple matching rules with priority', () => {
      // Given
      const rule1 = InvalidationRule.create({
        event: 'user.*',
        tags: ['all-users'],
        priority: 10,
      });
      const rule2 = InvalidationRule.create({
        event: 'user.updated',
        tags: ['updated-users'],
        priority: 5,
      });
      service.registerMany([rule1, rule2]);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.tags.sort()).toEqual(['all-users', 'updated-users']);
      expect(result.matchedRules).toHaveLength(2);
      // Rules should be in priority order
      expect(result.matchedRules[0].getPriority()).toBe(10);
      expect(result.matchedRules[1].getPriority()).toBe(5);
    });

    it('should return empty arrays when no rules match', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
      });
      service.register(rule);

      // When
      const result = service.resolve('post.created', {});

      // Then
      expect(result.tags).toEqual([]);
      expect(result.keys).toEqual([]);
      expect(result.matchedRules).toEqual([]);
    });

    it('should return empty arrays when all conditions fail', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
        condition: (payload: any) => payload.active === true,
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', { active: false });

      // Then
      expect(result.tags).toEqual([]);
      expect(result.keys).toEqual([]);
      expect(result.matchedRules).toEqual([]);
    });

    it('should handle complex payload with nested templates', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'order.updated',
        tags: ['user:{order.userId}', 'order:{order.id}'],
        keys: ['order:{order.id}'],
      });
      service.register(rule);

      // When
      const result = service.resolve('order.updated', {
        order: { id: 'o1', userId: 'u1' },
      });

      // Then
      expect(result.tags.sort()).toEqual(['order:o1', 'user:u1']);
      expect(result.keys).toEqual(['order:o1']);
    });

    it('should handle rules with both tags and keys', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
        tags: ['users'],
        keys: ['cache:all-users'],
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.tags).toEqual(['users']);
      expect(result.keys).toEqual(['cache:all-users']);
      expect(result.matchedRules).toHaveLength(1);
    });

    it('should resolve empty result when rules have no tags or keys', () => {
      // Given
      const rule = InvalidationRule.create({
        event: 'user.updated',
      });
      service.register(rule);

      // When
      const result = service.resolve('user.updated', {});

      // Then
      expect(result.tags).toEqual([]);
      expect(result.keys).toEqual([]);
      expect(result.matchedRules).toHaveLength(1);
    });
  });

  describe('getRules', () => {
    it('should return all registered rules', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.updated' });
      const rule2 = InvalidationRule.create({ event: 'user.created' });
      service.registerMany([rule1, rule2]);

      // When
      const rules = service.getRules();

      // Then
      expect(rules).toHaveLength(2);
      expect(rules).toContain(rule1);
      expect(rules).toContain(rule2);
    });

    it('should return empty array when no rules registered', () => {
      // Given/When
      const rules = service.getRules();

      // Then
      expect(rules).toEqual([]);
    });

    it('should return copy of rules array', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.updated' });
      service.register(rule);

      // When
      const rules1 = service.getRules();
      const rules2 = service.getRules();

      // Then - different array instances
      expect(rules1).not.toBe(rules2);
      expect(rules1).toEqual(rules2);
    });

    it('should not allow modifying internal rules through returned array', () => {
      // Given
      const rule = InvalidationRule.create({ event: 'user.updated' });
      service.register(rule);

      // When
      const rules = service.getRules();
      rules.pop();

      // Then - internal rules unchanged
      expect(service.getRules()).toHaveLength(1);
    });

    it('should return rules in priority order', () => {
      // Given
      const rule1 = InvalidationRule.create({ event: 'user.updated', priority: 5 });
      const rule2 = InvalidationRule.create({ event: 'user.created', priority: 10 });
      const rule3 = InvalidationRule.create({ event: 'user.deleted', priority: 3 });
      service.registerMany([rule1, rule2, rule3]);

      // When
      const rules = service.getRules();

      // Then
      expect(rules[0].getPriority()).toBe(10);
      expect(rules[1].getPriority()).toBe(5);
      expect(rules[2].getPriority()).toBe(3);
    });
  });
});
