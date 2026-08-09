/**
 * CacheKey value object.
 * Validates and builds cache keys with prefix, version, and validation.
 */

import { CacheKeyError } from '../../../shared/errors';

/**
 * Cache-key character validation mode.
 *
 * - `'safe'` (default): reject only what is genuinely dangerous — empty keys,
 *   whitespace, and control characters. Everything else is allowed, because
 *   Redis keys are binary-safe: `/`, `?`, `=`, `%`, unicode, etc. are valid.
 *   This lets URL / path keys (`http:/api/users/123`) work out of the box.
 * - `'strict'`: allow only `[A-Za-z0-9-_:.]` (the pre-1.9.2 behavior) for teams
 *   that want to enforce clean, predictable keys.
 * - `'off'`: no character validation at all (only empty + length are checked);
 *   for advanced users who fully own their key hygiene.
 */
export type KeyValidationMode = 'safe' | 'strict' | 'off';

export interface ICacheKeyOptions {
  maxLength?: number;
  prefix?: string;
  version?: string;
  separator?: string;
  /** Character validation mode. @default 'safe' */
  validation?: KeyValidationMode;
  /**
   * Custom allowlist pattern. When set, the key must match it (overrides
   * `validation`'s character check); empty/whitespace/length rules still apply.
   */
  pattern?: RegExp;
}

type ResolvedKeyOptions = Required<Omit<ICacheKeyOptions, 'pattern'>> & { pattern?: RegExp };

const DEFAULT_OPTIONS: ResolvedKeyOptions = {
  maxLength: 512,
  prefix: '',
  version: '',
  separator: ':',
  validation: 'safe',
  pattern: undefined,
};

// Control characters (C0 range + DEL) are never valid in a cache key.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Strict allowlist: alphanumeric, hyphen, underscore, colon, dot.
const STRICT_ALLOWED = /^[a-zA-Z0-9\-_:.]+$/;

export class CacheKey {
  private constructor(
    private readonly rawKey: string,
    private readonly options: ResolvedKeyOptions,
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
    const opts: ResolvedKeyOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Normalize: trim whitespace
    const normalizedKey = key.trim();

    // Validate key is not empty
    if (!normalizedKey || normalizedKey.length === 0) {
      throw new CacheKeyError(key, 'Key cannot be empty');
    }

    // Always reject whitespace and control characters — genuine footguns
    // (RESP/logging corruption, accidental trailing newlines from env vars),
    // regardless of validation mode.
    if (/\s/.test(normalizedKey)) {
      throw new CacheKeyError(key, 'Key cannot contain whitespace');
    }
    if (CONTROL_CHARS.test(normalizedKey)) {
      throw new CacheKeyError(key, 'Key cannot contain control characters');
    }

    // Character-set validation. Redis keys are binary-safe, so the default
    // 'safe' mode allows any printable character (incl. `/`, `?`, `=`, `%`,
    // unicode) — enough for URL / path keys. 'strict' keeps the historical
    // clean-key allowlist; 'off' skips the char check; a custom `pattern`
    // overrides the mode.
    if (opts.pattern) {
      if (!opts.pattern.test(normalizedKey)) {
        throw new CacheKeyError(key, `Key does not match the configured pattern ${opts.pattern}`);
      }
    } else if (opts.validation === 'strict') {
      if (!STRICT_ALLOWED.test(normalizedKey)) {
        throw new CacheKeyError(key, 'Invalid characters in key. Only alphanumeric, hyphens, underscores, colons, and dots allowed (validation: strict)');
      }
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
