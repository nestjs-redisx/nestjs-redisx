/**
 * Invalidation rule entity.
 * Defines what to invalidate when an event occurs.
 */

import { EventPattern } from '../value-objects/event-pattern.vo';
import { TagTemplate } from '../value-objects/tag-template.vo';

export interface IInvalidationRuleProps {
  event: string;
  tags?: string[];
  keys?: string[];
  condition?: (payload: unknown) => boolean;
  priority?: number;
}

export class InvalidationRule {
  private readonly eventPattern: EventPattern;
  private readonly tagTemplates: TagTemplate[];
  private readonly keyTemplates: TagTemplate[];
  private readonly condition?: (payload: unknown) => boolean;
  private readonly priority: number;

  private constructor(eventPattern: EventPattern, tagTemplates: TagTemplate[], keyTemplates: TagTemplate[], condition: ((payload: unknown) => boolean) | undefined, priority: number) {
    this.eventPattern = eventPattern;
    this.tagTemplates = tagTemplates;
    this.keyTemplates = keyTemplates;
    this.condition = condition;
    this.priority = priority;
  }

  /**
   * Creates InvalidationRule from props.
   */
  static create(props: IInvalidationRuleProps): InvalidationRule {
    const eventPattern = EventPattern.create(props.event);

    const tagTemplates = (props.tags ?? []).map((tag) => TagTemplate.create(tag));

    const keyTemplates = (props.keys ?? []).map((key) => TagTemplate.create(key));

    const priority = props.priority ?? 0;

    return new InvalidationRule(eventPattern, tagTemplates, keyTemplates, props.condition, priority);
  }

  /**
   * Tests if this rule matches the given event.
   */
  matches(event: string): boolean {
    return this.eventPattern.matches(event);
  }

  /**
   * Tests if condition passes for the given payload.
   */
  testCondition(payload: unknown): boolean {
    if (!this.condition) {
      return true;
    }

    try {
      return this.condition(payload);
    } catch {
      // If condition throws, treat as not passing
      return false;
    }
  }

  /**
   * Resolves tags for the given payload.
   */
  resolveTags(payload: unknown): string[] {
    return this.tagTemplates.map((template) => template.resolve(payload));
  }

  /**
   * Resolves keys for the given payload.
   */
  resolveKeys(payload: unknown): string[] {
    return this.keyTemplates.map((template) => template.resolve(payload));
  }

  /**
   * Gets rule priority (higher = processed first).
   */
  getPriority(): number {
    return this.priority;
  }

  /**
   * Gets the event pattern string.
   */
  getEventPattern(): string {
    return this.eventPattern.toString();
  }

  /**
   * Checks if rule has any tags.
   */
  hasTags(): boolean {
    return this.tagTemplates.length > 0;
  }

  /**
   * Checks if rule has any keys.
   */
  hasKeys(): boolean {
    return this.keyTemplates.length > 0;
  }

  /**
   * Checks if rule has a condition.
   */
  hasCondition(): boolean {
    return this.condition !== undefined;
  }
}
