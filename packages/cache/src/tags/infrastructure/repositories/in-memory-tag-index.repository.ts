/**
 * In-memory tag index for `mode: 'l1-only'`.
 *
 * A drop-in {@link ITagIndex} that keeps the tag → keys mapping in a local
 * `Map<tag, Set<key>>` instead of Redis sets, so tag-based invalidation works
 * with NO Redis (single-instance). It mirrors {@link TagIndexRepository}: it
 * stores the FULL (prefixed) cache keys it is given, validates via the same
 * Tag/Tags value objects, and — on invalidation — removes the tagged values
 * from the in-memory L2 store through the {@link IL2CacheStore} port (so no
 * concrete coupling and no stale entries left behind).
 */

import { Injectable, Inject } from '@nestjs/common';

import { L2_CACHE_STORE, CACHE_PLUGIN_OPTIONS } from '../../../shared/constants';
import { TagInvalidationError } from '../../../shared/errors';
import { ICachePluginOptions } from '../../../shared/types';
import { IL2CacheStore } from '../../../cache/application/ports/l2-cache-store.port';
import { Tag } from '../../../cache/domain/value-objects/tag.vo';
import { Tags } from '../../../cache/domain/value-objects/tags.vo';
import { ITagIndex } from '../../application/ports/tag-index.port';

@Injectable()
export class InMemoryTagIndexRepository implements ITagIndex {
  private readonly tagToKeys = new Map<string, Set<string>>();
  private readonly keyPrefix: string;

  constructor(
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly options: ICachePluginOptions,
    @Inject(L2_CACHE_STORE) private readonly l2Store: IL2CacheStore,
  ) {
    this.keyPrefix = options.l2?.keyPrefix ?? 'cache:';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addKeyToTags(key: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }
    try {
      for (const tag of this.validateTags(tags)) {
        let set = this.tagToKeys.get(tag);
        if (!set) {
          set = new Set<string>();
          this.tagToKeys.set(tag, set);
        }
        set.add(key);
      }
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to add key "${key}" to tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async removeKeyFromTags(key: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }
    try {
      for (const tag of this.validateTags(tags)) {
        const set = this.tagToKeys.get(tag);
        if (set) {
          set.delete(key);
          if (set.size === 0) {
            this.tagToKeys.delete(tag);
          }
        }
      }
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to remove key "${key}" from tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getKeysByTag(tag: string): Promise<string[]> {
    try {
      const validTag = Tag.create(tag).toString();
      const set = this.tagToKeys.get(validTag);
      return set ? [...set] : [];
    } catch (error) {
      throw new TagInvalidationError(tag, `Failed to get keys for tag: ${(error as Error).message}`, error as Error);
    }
  }

  async invalidateTag(tag: string): Promise<number> {
    try {
      const validTag = Tag.create(tag).toString();
      const set = this.tagToKeys.get(validTag);
      if (!set || set.size === 0) {
        this.tagToKeys.delete(validTag);
        return 0;
      }

      let deletedCount = 0;
      for (const fullKey of set) {
        // Keys are stored with the L2 prefix; the store's delete() re-adds it.
        const unprefixed = fullKey.startsWith(this.keyPrefix) ? fullKey.slice(this.keyPrefix.length) : fullKey;
        if (await this.l2Store.delete(unprefixed)) {
          deletedCount++;
        }
      }

      this.tagToKeys.delete(validTag);
      return deletedCount;
    } catch (error) {
      throw new TagInvalidationError(tag, `Failed to invalidate tag: ${(error as Error).message}`, error as Error);
    }
  }

  async invalidateTags(tags: string[]): Promise<number> {
    if (tags.length === 0) {
      return 0;
    }
    try {
      let total = 0;
      for (const tag of this.validateTags(tags)) {
        total += await this.invalidateTag(tag);
      }
      return total;
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to invalidate tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clearAllTags(): Promise<void> {
    // Mirrors the Redis repository: clears the tag index only. Cached values are
    // cleared separately by CacheService via the L2 store.
    this.tagToKeys.clear();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getTagStats(tag: string): Promise<{ keyCount: number; exists: boolean }> {
    try {
      const validTag = Tag.create(tag).toString();
      const set = this.tagToKeys.get(validTag);
      const keyCount = set?.size ?? 0;
      return { keyCount, exists: keyCount > 0 };
    } catch {
      return { keyCount: 0, exists: false };
    }
  }

  private validateTags(tags: string[]): string[] {
    const maxTags = this.options.tags?.maxTagsPerKey ?? 10;
    return Tags.create(tags, maxTags).toStrings();
  }
}
