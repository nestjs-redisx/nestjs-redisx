/**
 * TTL (Time To Live) value object.
 * Validates and normalizes TTL values.
 */

import { ErrorCode } from '@nestjs-redisx/core';

import { CacheError } from '../../../shared/errors';

/** Default maximum TTL in seconds (24 hours). */
const DEFAULT_MAX_TTL_SECONDS = 86_400;

export class TTL {
  private constructor(private readonly seconds: number) {}

  /**
   * Creates a TTL value object.
   *
   * @param seconds - TTL in seconds
   * @param maxTtl - Maximum allowed TTL
   * @returns TTL instance
   * @throws CacheError if validation fails
   */
  static create(seconds: number, maxTtl: number = DEFAULT_MAX_TTL_SECONDS): TTL {
    // Validate positive
    if (seconds <= 0) {
      throw new CacheError(`TTL must be positive (got ${seconds})`, ErrorCode.CACHE_KEY_INVALID);
    }

    // Validate not too large
    if (seconds > maxTtl) {
      throw new CacheError(`TTL exceeds maximum (${seconds} > ${maxTtl})`, ErrorCode.CACHE_KEY_INVALID);
    }

    // Round to nearest second
    const rounded = Math.round(seconds);

    return new TTL(rounded);
  }

  /**
   * Creates TTL from milliseconds.
   *
   * @param milliseconds - TTL in milliseconds
   * @param maxTtl - Maximum allowed TTL in seconds
   * @returns TTL instance
   */
  static fromMilliseconds(milliseconds: number, maxTtl: number = DEFAULT_MAX_TTL_SECONDS): TTL {
    return TTL.create(Math.ceil(milliseconds / 1000), maxTtl);
  }

  /**
   * Returns TTL in seconds.
   */
  toSeconds(): number {
    return this.seconds;
  }

  /**
   * Returns TTL in milliseconds.
   */
  toMilliseconds(): number {
    return this.seconds * 1000;
  }

  /**
   * Checks if TTL is less than another TTL.
   */
  isLessThan(other: TTL): boolean {
    return this.seconds < other.seconds;
  }

  /**
   * Checks if TTL is greater than another TTL.
   */
  isGreaterThan(other: TTL): boolean {
    return this.seconds > other.seconds;
  }

  /**
   * Returns the minimum of two TTLs.
   */
  static min(a: TTL, b: TTL): TTL {
    return a.isLessThan(b) ? a : b;
  }

  /**
   * Returns the maximum of two TTLs.
   */
  static max(a: TTL, b: TTL): TTL {
    return a.isGreaterThan(b) ? a : b;
  }

  /**
   * Checks equality with another TTL.
   */
  equals(other: TTL): boolean {
    return this.seconds === other.seconds;
  }

  /**
   * Returns string representation.
   */
  toString(): string {
    return `${this.seconds}s`;
  }
}
