/**
 * Tags collection value object.
 * Validates and manages a collection of tags with deduplication.
 */

import { ErrorCode } from '@nestjs-redisx/core';

import { Tag } from './tag.vo';
import { CacheError } from '../../../shared/errors';

const DEFAULT_MAX_TAGS = 10;

export class Tags {
  private constructor(private readonly tags: Tag[]) {}

  /**
   * Creates a validated tags collection.
   *
   * @param values - Array of tag values
   * @param maxTags - Maximum number of tags (default: 10)
   * @returns Tags instance
   * @throws CacheError if validation fails
   *
   * @example
   * ```typescript
   * const tags = Tags.create(['users', 'product:123']);
   * const singleTag = Tags.create(['cache']);
   * ```
   */
  static create(values: string[], maxTags: number = DEFAULT_MAX_TAGS): Tags {
    // Validate max tags before processing
    if (values.length > maxTags) {
      throw new CacheError(`Too many tags (${values.length} > ${maxTags})`, ErrorCode.CACHE_KEY_INVALID);
    }

    // Convert to Tag objects (validates each tag)
    const tagObjects = values.map((v) => Tag.create(v));

    // Remove duplicates by converting to Set and back
    const uniqueValues = Array.from(new Set(tagObjects.map((t) => t.toString())));

    // Recreate Tag objects from unique values
    const uniqueTags = uniqueValues.map((v) => Tag.create(v));

    return new Tags(uniqueTags);
  }

  /**
   * Creates empty tags collection.
   */
  static empty(): Tags {
    return new Tags([]);
  }

  /**
   * Returns array of tag strings.
   */
  toStrings(): string[] {
    return this.tags.map((t) => t.toString());
  }

  /**
   * Returns array of Tag objects.
   */
  toArray(): Tag[] {
    return [...this.tags];
  }

  /**
   * Returns number of tags.
   */
  size(): number {
    return this.tags.length;
  }

  /**
   * Checks if collection contains a specific tag.
   */
  has(tag: Tag): boolean {
    return this.tags.some((t) => t.equals(tag));
  }

  /**
   * Checks if collection is empty.
   */
  isEmpty(): boolean {
    return this.tags.length === 0;
  }

  /**
   * Iterates over tags.
   */
  forEach(callback: (tag: Tag, index: number) => void): void {
    this.tags.forEach(callback);
  }

  /**
   * Maps over tags.
   */
  map<T>(callback: (tag: Tag, index: number) => T): T[] {
    return this.tags.map(callback);
  }
}
