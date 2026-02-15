/**
 * Tag template value object.
 * Supports placeholders like 'user:{userId}' or 'tenant:{payload.tenantId}'.
 */

import { ErrorCode } from '@nestjs-redisx/core';

import { CacheError } from '../../../shared/errors';

export class TagTemplate {
  private readonly template: string;
  private readonly placeholders: string[];

  private constructor(template: string, placeholders: string[]) {
    this.template = template;
    this.placeholders = placeholders;
  }

  /**
   * Creates TagTemplate from template string.
   * @param template - Template string with placeholders (e.g., 'user:{userId}')
   */
  static create(template: string): TagTemplate {
    if (!template || template.trim().length === 0) {
      throw new CacheError('Tag template cannot be empty', ErrorCode.VALIDATION_FAILED);
    }

    const normalized = template.trim();

    // Extract placeholders
    const placeholders: string[] = [];
    const placeholderRegex = /\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = placeholderRegex.exec(normalized)) !== null) {
      placeholders.push(match[1]!);
    }

    return new TagTemplate(normalized, placeholders);
  }

  /**
   * Resolves template with given payload.
   * @param payload - Data object to resolve placeholders from
   * @returns Resolved tag string
   */
  resolve(payload: unknown): string {
    return this.template.replace(/\{([^}]+)\}/g, (_, path) => {
      const value = this.getNestedValue(payload, path);
      if (value === undefined || value === null) {
        // Keep placeholder unresolved if value not found
        return `{${path}}`;
      }
      return String(value);
    });
  }

  /**
   * Returns the raw template string.
   */
  toString(): string {
    return this.template;
  }

  /**
   * Returns all placeholders in the template.
   */
  getPlaceholders(): string[] {
    return [...this.placeholders];
  }

  /**
   * Checks if template has any placeholders.
   */
  hasPlaceholders(): boolean {
    return this.placeholders.length > 0;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current !== 'object') {
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
