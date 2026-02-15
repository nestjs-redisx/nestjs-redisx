/**
 * Event pattern value object.
 * Supports AMQP-style wildcards: '*' for one word, '#' for zero or more words.
 */

import { ErrorCode } from '@nestjs-redisx/core';

import { CacheError } from '../../../shared/errors';

export class EventPattern {
  private readonly pattern: string;
  private readonly regex: RegExp;

  private constructor(pattern: string, regex: RegExp) {
    this.pattern = pattern;
    this.regex = regex;
  }

  /**
   * Creates EventPattern from string pattern.
   * @param pattern - AMQP-style pattern (e.g., 'user.*', 'order.#', 'product.updated')
   */
  static create(pattern: string): EventPattern {
    if (!pattern || pattern.trim().length === 0) {
      throw new CacheError('Event pattern cannot be empty', ErrorCode.VALIDATION_FAILED);
    }

    const normalized = pattern.trim();

    // Validate pattern format
    if (!/^[a-z0-9*#._-]+$/i.test(normalized)) {
      throw new CacheError(`Invalid event pattern "${normalized}". Only alphanumeric, dots, dashes, underscores, *, and # are allowed`, ErrorCode.VALIDATION_FAILED);
    }

    // Convert AMQP-style pattern to regex
    // '*' matches exactly one word (one segment between dots)
    // '#' matches zero or more words
    let regexStr = normalized
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '[^.]+') // * = one word
      .replace(/#/g, '.*'); // # = zero or more words

    // If pattern ends with .#, make the dot optional to match zero words
    regexStr = regexStr.replace(/\\\.\.\*$/, '(?:\\..*)?');

    const regex = new RegExp(`^${regexStr}$`);

    return new EventPattern(normalized, regex);
  }

  /**
   * Tests if this pattern matches the given event.
   */
  matches(event: string): boolean {
    return this.regex.test(event);
  }

  /**
   * Returns the raw pattern string.
   */
  toString(): string {
    return this.pattern;
  }

  /**
   * Checks equality with another pattern.
   */
  equals(other: EventPattern): boolean {
    return this.pattern === other.pattern;
  }
}
