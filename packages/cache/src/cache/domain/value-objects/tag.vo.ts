/**
 * Tag value object.
 * Validates and normalizes cache tags for invalidation.
 */

import { ErrorCode } from '@nestjs-redisx/core';

import { CacheError } from '../../../shared/errors';

const DEFAULT_MAX_LENGTH = 128;

export class Tag {
  private constructor(private readonly value: string) {}

  /**
   * Creates a validated tag.
   *
   * @param value - Tag value
   * @param maxLength - Maximum tag length (default: 128)
   * @returns Tag instance
   * @throws CacheError if validation fails
   *
   * @example
   * ```typescript
   * const tag = Tag.create('users');
   * const productTag = Tag.create('product:123');
   * ```
   */
  static create(value: string, maxLength: number = DEFAULT_MAX_LENGTH): Tag {
    // Validate not empty
    if (!value || value.length === 0) {
      throw new CacheError('Tag cannot be empty', ErrorCode.CACHE_KEY_INVALID);
    }

    // Normalize: trim and lowercase
    const normalized = value.trim().toLowerCase();

    // Validate not empty after normalization
    if (normalized.length === 0) {
      throw new CacheError('Tag cannot be empty after normalization', ErrorCode.CACHE_KEY_INVALID);
    }

    // Validate no whitespace
    if (/\s/.test(normalized)) {
      throw new CacheError('Tag cannot contain whitespace', ErrorCode.CACHE_KEY_INVALID);
    }

    // Validate allowed characters (alphanumeric, -, _, :, .)
    if (!/^[a-z0-9\-_:.]+$/.test(normalized)) {
      throw new CacheError('Invalid tag characters. Only lowercase alphanumeric, hyphens, underscores, colons, and dots allowed', ErrorCode.CACHE_KEY_INVALID);
    }

    // Validate length
    if (normalized.length > maxLength) {
      throw new CacheError(`Tag exceeds maximum length (${normalized.length} > ${maxLength})`, ErrorCode.CACHE_KEY_INVALID);
    }

    return new Tag(normalized);
  }

  /**
   * Returns the tag value.
   */
  toString(): string {
    return this.value;
  }

  /**
   * Returns the raw tag value.
   */
  getRaw(): string {
    return this.value;
  }

  /**
   * Checks equality with another tag.
   */
  equals(other: Tag): boolean {
    return this.value === other.value;
  }
}
