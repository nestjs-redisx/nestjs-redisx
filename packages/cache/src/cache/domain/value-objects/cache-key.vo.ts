/**
 * CacheKey value object.
 * Validates and builds cache keys with prefix, version, and validation.
 */

import { CacheKeyError } from '../../../shared/errors';

export interface ICacheKeyOptions {
  maxLength?: number;
  prefix?: string;
  version?: string;
  separator?: string;
}

const DEFAULT_OPTIONS: Required<ICacheKeyOptions> = {
  maxLength: 512,
  prefix: '',
  version: '',
  separator: ':',
};

export class CacheKey {
  private constructor(
    private readonly rawKey: string,
    private readonly options: Required<ICacheKeyOptions>,
  ) {}

  /**
   * Creates a validated cache key.
   *
   * @param key - Raw key
   * @param options - Key options
   * @returns CacheKey instance
   * @throws CacheKeyError if validation fails
   */
  static create(key: string, options: ICacheKeyOptions = {}): CacheKey {
    const opts: Required<ICacheKeyOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Normalize: trim whitespace
    const normalizedKey = key.trim();

    // Validate key is not empty
    if (!normalizedKey || normalizedKey.length === 0) {
      throw new CacheKeyError(key, 'Key cannot be empty');
    }

    // Validate no whitespace
    if (/\s/.test(normalizedKey)) {
      throw new CacheKeyError(key, 'Key cannot contain whitespace');
    }

    // Validate allowed characters (alphanumeric, -, _, :, .)
    if (!/^[a-zA-Z0-9\-_:.]+$/.test(normalizedKey)) {
      throw new CacheKeyError(key, 'Invalid characters in key. Only alphanumeric, hyphens, underscores, colons, and dots allowed');
    }

    // Build full key
    const fullKey = opts.prefix + opts.version + (opts.version ? opts.separator : '') + normalizedKey;

    // Validate length
    if (fullKey.length > opts.maxLength) {
      throw new CacheKeyError(normalizedKey, `Key exceeds maximum length (${fullKey.length} > ${opts.maxLength})`);
    }

    return new CacheKey(normalizedKey, opts);
  }

  /**
   * Returns the full cache key with prefix and version.
   */
  toString(): string {
    return this.options.prefix + this.options.version + (this.options.version ? this.options.separator : '') + this.rawKey;
  }

  /**
   * Returns the raw key without prefix/version.
   */
  getRaw(): string {
    return this.rawKey;
  }

  /**
   * Returns the prefix.
   */
  getPrefix(): string {
    return this.options.prefix;
  }

  /**
   * Returns the version.
   */
  getVersion(): string {
    return this.options.version;
  }

  /**
   * Checks equality with another CacheKey.
   */
  equals(other: CacheKey): boolean {
    return this.toString() === other.toString();
  }
}
