/**
 * Invalidation registry service.
 * Manages invalidation rules and resolves what to invalidate for events.
 */

import { Injectable, Logger } from '@nestjs/common';

import { InvalidationRule } from '../../domain/entities/invalidation-rule.entity';
import { IInvalidationRegistry, IResolvedInvalidation } from '../ports/invalidation-registry.port';

@Injectable()
export class InvalidationRegistryService implements IInvalidationRegistry {
  private readonly logger = new Logger(InvalidationRegistryService.name);
  private rules: InvalidationRule[] = [];

  register(rule: InvalidationRule): void {
    this.rules.push(rule);
    // Sort by priority (higher first)
    this.rules.sort((a, b) => b.getPriority() - a.getPriority());

    this.logger.debug(`Registered invalidation rule for event "${rule.getEventPattern()}" with priority ${rule.getPriority()}`);
  }

  registerMany(rules: InvalidationRule[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  unregister(event: string): void {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter((r) => r.getEventPattern() !== event);

    const removed = initialLength - this.rules.length;
    if (removed > 0) {
      this.logger.debug(`Unregistered ${removed} rule(s) for event "${event}"`);
    }
  }

  findRules(event: string): InvalidationRule[] {
    return this.rules.filter((rule) => rule.matches(event));
  }

  resolve(event: string, payload: unknown): IResolvedInvalidation {
    const matchedRules = this.findRules(event);
    const tagsSet = new Set<string>();
    const keysSet = new Set<string>();
    const applicableRules: InvalidationRule[] = [];

    for (const rule of matchedRules) {
      // Test condition
      if (!rule.testCondition(payload)) {
        this.logger.debug(`Rule for event "${rule.getEventPattern()}" skipped - condition not met`);
        continue;
      }

      applicableRules.push(rule);

      // Resolve tags
      if (rule.hasTags()) {
        const tags = rule.resolveTags(payload);
        for (const tag of tags) {
          // Only add if fully resolved (no remaining placeholders)
          if (!tag.includes('{')) {
            tagsSet.add(tag);
          } else {
            this.logger.warn(`Tag template "${tag}" has unresolved placeholders for event "${event}"`);
          }
        }
      }

      // Resolve keys
      if (rule.hasKeys()) {
        const keys = rule.resolveKeys(payload);
        for (const key of keys) {
          // Only add if fully resolved
          if (!key.includes('{')) {
            keysSet.add(key);
          } else {
            this.logger.warn(`Key template "${key}" has unresolved placeholders for event "${event}"`);
          }
        }
      }
    }

    return {
      tags: Array.from(tagsSet),
      keys: Array.from(keysSet),
      matchedRules: applicableRules,
    };
  }

  getRules(): InvalidationRule[] {
    return [...this.rules];
  }
}
