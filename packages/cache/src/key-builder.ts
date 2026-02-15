/**
 * Fluent key builder for cache keys.
 *
 * Provides a convenient API for building cache keys with proper formatting,
 * validation, and separation.
 *
 * @example
 * ```typescript
 * // Simple key
 * const key = KeyBuilder.create()
 *   .prefix('app')
 *   .segment('user')
 *   .segment('123')
 *   .build();
 * // 'app:user:123'
 *
 * // With namespace
 * const key = KeyBuilder.create()
 *   .namespace('tenant-5')
 *   .prefix('cache')
 *   .segment('product')
 *   .segment('456')
 *   .build();
 * // 'tenant-5:cache:product:456'
 *
 * // From template
 * const key = KeyBuilder.fromTemplate('user:{userId}:post:{postId}', {
 *   userId: '123',
 *   postId: '456',
 * });
 * // 'user:123:post:456'
 *
 * // With versioning
 * const key = KeyBuilder.create()
 *   .prefix('cache')
 *   .version('v2')
 *   .segment('user')
 *   .segment('123')
 *   .build();
 * // 'cache:v2:user:123'
 * ```
 */

import { CacheKeyError } from './shared/errors';

export interface IKeyBuilderOptions {
  /**
   * Separator between segments (default: ':')
   */
  separator?: string;

  /**
   * Maximum key length (default: 512)
   */
  maxLength?: number;

  /**
   * Whether to validate segments for invalid characters (default: true)
   */
  validate?: boolean;

  /**
   * Whether to convert segments to lowercase (default: false)
   */
  lowercase?: boolean;
}

export class KeyBuilder {
  private keySegments: string[] = [];
  private options: Required<IKeyBuilderOptions>;

  private constructor(options: IKeyBuilderOptions = {}) {
    this.options = {
      separator: options.separator ?? ':',
      maxLength: options.maxLength ?? 512,
      validate: options.validate ?? true,
      lowercase: options.lowercase ?? false,
    };
  }

  /**
   * Creates a new KeyBuilder instance.
   *
   * @param options - Builder options
   * @returns New KeyBuilder
   */
  static create(options?: IKeyBuilderOptions): KeyBuilder {
    return new KeyBuilder(options);
  }

  /**
   * Creates a key from a template string with placeholders.
   *
   * @param template - Template string (e.g., 'user:{id}:post:{postId}')
   * @param params - Parameter values
   * @param options - Builder options
   * @returns Generated key
   *
   * @example
   * ```typescript
   * KeyBuilder.fromTemplate('user:{id}', { id: '123' })
   * // 'user:123'
   *
   * KeyBuilder.fromTemplate('user:{userId}:post:{postId}', {
   *   userId: '123',
   *   postId: '456',
   * })
   * // 'user:123:post:456'
   * ```
   */
  static fromTemplate(template: string, params: Record<string, string | number>, options?: IKeyBuilderOptions): string {
    let result = template;
    const placeholderRegex = /\{([^}]+)\}/g;

    const matches = Array.from(template.matchAll(placeholderRegex));

    for (const match of matches) {
      const placeholder = match[0]; // e.g., '{id}'
      const paramName = match[1]; // e.g., 'id'

      if (!paramName) {
        continue;
      }

      if (!(paramName in params)) {
        throw new CacheKeyError(template, `Parameter '${paramName}' not found in params`);
      }

      const value = params[paramName];
      if (value === null || value === undefined) {
        throw new CacheKeyError(template, `Parameter '${paramName}' is null or undefined`);
      }

      result = result.replace(placeholder, String(value));
    }

    // Validate the final key
    const builder = new KeyBuilder(options);
    builder.validateKey(result);

    return result;
  }

  /**
   * Creates a key from an array of segments.
   *
   * @param segments - Array of key segments
   * @param options - Builder options
   * @returns Generated key
   */
  static fromSegments(segments: string[], options?: IKeyBuilderOptions): string {
    const builder = new KeyBuilder(options);
    segments.forEach((segment) => builder.segment(segment));
    return builder.build();
  }

  /**
   * Adds a namespace segment (first segment).
   *
   * @param ns - Namespace value
   * @returns This builder for chaining
   */
  namespace(ns: string): this {
    this.keySegments.unshift(this.normalizeSegment(ns));
    return this;
  }

  /**
   * Adds a prefix segment.
   *
   * @param prefix - Prefix value
   * @returns This builder for chaining
   */
  prefix(prefix: string): this {
    return this.segment(prefix);
  }

  /**
   * Adds a version segment.
   *
   * @param version - Version value (e.g., 'v1', 'v2')
   * @returns This builder for chaining
   */
  version(version: string): this {
    return this.segment(version);
  }

  /**
   * Adds a segment to the key.
   *
   * @param value - Segment value
   * @returns This builder for chaining
   */
  segment(value: string | number): this {
    this.keySegments.push(this.normalizeSegment(String(value)));
    return this;
  }

  /**
   * Adds multiple segments at once.
   *
   * @param values - Array of segment values
   * @returns This builder for chaining
   */
  segments(...values: Array<string | number>): this {
    values.forEach((value) => this.segment(value));
    return this;
  }

  /**
   * Adds a tag segment (useful for grouping).
   *
   * @param tag - Tag value
   * @returns This builder for chaining
   */
  tag(tag: string): this {
    this.segment('tag');
    this.segment(tag);
    return this;
  }

  /**
   * Adds timestamp segment.
   *
   * @param timestamp - Unix timestamp (default: now)
   * @returns This builder for chaining
   */
  timestamp(timestamp?: number): this {
    return this.segment(timestamp ?? Date.now());
  }

  /**
   * Adds a hash segment from an object.
   * Useful for cache keys based on complex objects.
   *
   * @param obj - Object to hash
   * @returns This builder for chaining
   */
  hash(obj: unknown): this {
    const hash = this.simpleHash(JSON.stringify(obj));
    return this.segment(hash);
  }

  /**
   * Builds and returns the final key.
   *
   * @returns Generated cache key
   * @throws CacheKeyError if key is invalid
   */
  build(): string {
    if (this.keySegments.length === 0) {
      throw new CacheKeyError('', 'Cannot build key with no segments');
    }

    const key = this.keySegments.join(this.options.separator);
    this.validateKey(key);

    return key;
  }

  /**
   * Resets the builder to initial state.
   *
   * @returns This builder for chaining
   */
  reset(): this {
    this.keySegments = [];
    return this;
  }

  /**
   * Gets current segments.
   *
   * @returns Array of segments
   */
  getSegments(): string[] {
    return [...this.keySegments];
  }

  /**
   * Normalizes a segment value.
   *
   * @param value - Segment value
   * @returns Normalized value
   */
  private normalizeSegment(value: string): string {
    let normalized = value.trim();

    if (this.options.lowercase) {
      normalized = normalized.toLowerCase();
    }

    if (this.options.validate) {
      // Check for invalid characters
      const invalidChars = [this.options.separator, '{', '}', ' ', '\n', '\r', '\t'];
      for (const char of invalidChars) {
        if (normalized.includes(char)) {
          throw new CacheKeyError(normalized, `Segment contains invalid character: '${char}'`);
        }
      }

      // Check for empty segment
      if (normalized.length === 0) {
        throw new CacheKeyError(normalized, 'Segment cannot be empty');
      }
    }

    return normalized;
  }

  /**
   * Validates a complete key.
   *
   * @param key - Key to validate
   * @throws CacheKeyError if key is invalid
   */
  private validateKey(key: string): void {
    if (!this.options.validate) {
      return;
    }

    if (key.length === 0) {
      throw new CacheKeyError(key, 'Key cannot be empty');
    }

    if (key.length > this.options.maxLength) {
      throw new CacheKeyError(key, `Key length ${key.length} exceeds maximum ${this.options.maxLength}`);
    }

    // Check for invalid patterns
    if (key.startsWith(this.options.separator) || key.endsWith(this.options.separator)) {
      throw new CacheKeyError(key, 'Key cannot start or end with separator');
    }

    // Check for consecutive separators
    const consecutiveSeparators = this.options.separator + this.options.separator;
    if (key.includes(consecutiveSeparators)) {
      throw new CacheKeyError(key, 'Key cannot contain consecutive separators');
    }
  }

  /**
   * Simple hash function for objects.
   *
   * @param str - String to hash
   * @returns Hash string
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
