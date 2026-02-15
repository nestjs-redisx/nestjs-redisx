/**
 * Tag index repository interface.
 */

export interface ITagIndex {
  /**
   * Adds cache key to tag indexes.
   *
   * @param key - Cache key (with full prefix)
   * @param tags - Array of tags
   */
  addKeyToTags(key: string, tags: string[]): Promise<void>;

  /**
   * Removes cache key from specified tag indexes.
   *
   * @param key - Cache key
   * @param tags - Tags to remove the key from
   */
  removeKeyFromTags(key: string, tags: string[]): Promise<void>;

  /**
   * Gets all cache keys associated with a tag.
   *
   * @param tag - Tag name
   * @returns Array of cache keys
   */
  getKeysByTag(tag: string): Promise<string[]>;

  /**
   * Invalidates tag - deletes all associated cache keys and the tag index.
   *
   * @param tag - Tag name
   * @returns Number of keys deleted
   */
  invalidateTag(tag: string): Promise<number>;

  /**
   * Invalidates multiple tags.
   *
   * @param tags - Array of tag names
   * @returns Total number of keys deleted
   */
  invalidateTags(tags: string[]): Promise<number>;

  /**
   * Clears all tag indexes.
   */
  clearAllTags(): Promise<void>;

  /**
   * Gets statistics for a specific tag.
   *
   * @param tag - Tag name
   * @returns Object with key count and existence flag
   */
  getTagStats(tag: string): Promise<{ keyCount: number; exists: boolean }>;
}
