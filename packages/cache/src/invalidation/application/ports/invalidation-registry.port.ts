/**
 * Invalidation registry port.
 */

import { InvalidationRule } from '../../domain/entities/invalidation-rule.entity';

export interface IResolvedInvalidation {
  tags: string[];
  keys: string[];
  matchedRules: InvalidationRule[];
}

export interface IInvalidationRegistry {
  /**
   * Register invalidation rule.
   */
  register(rule: InvalidationRule): void;

  /**
   * Register multiple rules.
   */
  registerMany(rules: InvalidationRule[]): void;

  /**
   * Unregister rule by event pattern.
   */
  unregister(event: string): void;

  /**
   * Find matching rules for event.
   */
  findRules(event: string): InvalidationRule[];

  /**
   * Resolve tags/keys for event with payload.
   */
  resolve(event: string, payload: unknown): IResolvedInvalidation;

  /**
   * Get all registered rules.
   */
  getRules(): InvalidationRule[];
}
