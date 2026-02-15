/**
 * CacheEntry value object.
 * Wraps cached value with metadata.
 */

export class CacheEntry<T> {
  private constructor(
    public readonly value: T,
    public readonly cachedAt: number,
    public readonly ttl: number,
    public readonly tags?: string[],
  ) {}

  /**
   * Creates a cache entry.
   *
   * @param value - Value to cache
   * @param ttl - TTL in seconds
   * @param tags - Optional tags
   * @returns CacheEntry instance
   */
  static create<T>(value: T, ttl: number, tags?: string[]): CacheEntry<T> {
    return new CacheEntry(value, Date.now(), ttl, tags);
  }

  /**
   * Checks if entry is expired.
   *
   * @returns true if expired, false otherwise
   */
  isExpired(): boolean {
    const expiresAt = this.cachedAt + this.ttl * 1000;
    return Date.now() > expiresAt;
  }

  /**
   * Gets time until expiration in milliseconds.
   *
   * @returns Milliseconds until expiration (0 if expired)
   */
  getTimeToLive(): number {
    const expiresAt = this.cachedAt + this.ttl * 1000;
    const remaining = expiresAt - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Gets age of entry in milliseconds.
   *
   * @returns Age in milliseconds
   */
  getAge(): number {
    return Date.now() - this.cachedAt;
  }

  /**
   * Checks if entry has a specific tag.
   *
   * @param tag - Tag to check
   * @returns true if entry has the tag
   */
  hasTag(tag: string): boolean {
    return this.tags?.includes(tag) ?? false;
  }

  /**
   * Serializes entry to JSON.
   *
   * @returns JSON representation
   */
  toJSON(): {
    value: T;
    cachedAt: number;
    ttl: number;
    tags?: string[];
  } {
    return {
      value: this.value,
      cachedAt: this.cachedAt,
      ttl: this.ttl,
      tags: this.tags,
    };
  }

  /**
   * Deserializes entry from JSON.
   *
   * @param json - JSON representation
   * @returns CacheEntry instance
   */
  static fromJSON<T>(json: { value: T; cachedAt: number; ttl: number; tags?: string[] }): CacheEntry<T> {
    return new CacheEntry(json.value, json.cachedAt, json.ttl, json.tags);
  }
}
