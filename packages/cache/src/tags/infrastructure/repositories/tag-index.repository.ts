/**
 * Tag index repository for tag-based cache invalidation.
 * Maintains mapping of tags to cache keys.
 */

import { Injectable, Inject } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver } from '@nestjs-redisx/core';

import { Tag } from '../../../cache/domain/value-objects/tag.vo';
import { Tags } from '../../../cache/domain/value-objects/tags.vo';
import { CACHE_PLUGIN_OPTIONS, LUA_SCRIPT_LOADER } from '../../../shared/constants';
import { TagInvalidationError } from '../../../shared/errors';
import { ICachePluginOptions } from '../../../shared/types';
import { ITagIndex } from '../../application/ports/tag-index.port';
import { LuaScriptLoader } from '../services/lua-script-loader.service';

/** Batch size for tag key deletion and SCAN operations. */
const TAG_BATCH_SIZE = 100;

@Injectable()
export class TagIndexRepository implements ITagIndex {
  private readonly tagPrefix: string;

  constructor(
    @Inject(REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly options: ICachePluginOptions,
    @Inject(LUA_SCRIPT_LOADER) private readonly luaLoader: LuaScriptLoader,
  ) {
    // Tag prefix should include L2 key prefix
    const l2Prefix = options.l2?.keyPrefix ?? 'cache:';
    const tagIndexPrefix = options.tags?.indexPrefix ?? '_tag:';
    this.tagPrefix = `${l2Prefix}${tagIndexPrefix}`;
  }

  async addKeyToTags(key: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }

    try {
      // Validate tags using Tags VO
      const validatedTags = this.validateTags(tags);
      // Tag TTL should be at least as long as the max cache TTL
      // to ensure tag indexes remain valid for all cached entries
      const tagTtl = this.options.tags?.ttl ?? this.options.l2?.maxTtl ?? 86400;

      // Cluster-safe: use individual operations instead of Lua script
      // This avoids CROSSSLOT errors when tag keys are on different slots
      const operations = validatedTags.map(async (tag) => {
        const tagKey = this.buildTagKey(tag);
        await this.driver.sadd(tagKey, key);
        await this.driver.expire(tagKey, tagTtl);
      });

      await Promise.all(operations);
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to add key "${key}" to tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  async removeKeyFromTags(key: string, tags: string[]): Promise<void> {
    if (tags.length === 0) {
      return;
    }

    try {
      // Validate tags using Tags VO
      const validatedTags = this.validateTags(tags);

      // Cluster-safe: remove from each tag individually
      await Promise.all(
        validatedTags.map(async (tag) => {
          const tagKey = this.buildTagKey(tag);
          await this.driver.srem(tagKey, key);
        }),
      );
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to remove key "${key}" from tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  async getKeysByTag(tag: string): Promise<string[]> {
    try {
      // Validate tag using Tag VO
      const validTag = Tag.create(tag);
      const tagKey = this.buildTagKey(validTag.toString());
      const keys = await this.driver.smembers(tagKey);
      return keys;
    } catch (error) {
      throw new TagInvalidationError(tag, `Failed to get keys for tag: ${(error as Error).message}`, error as Error);
    }
  }

  async invalidateTag(tag: string): Promise<number> {
    try {
      // Validate tag using Tag VO
      const validTag = Tag.create(tag);
      const tagKey = this.buildTagKey(validTag.toString());

      // Get all cache keys for this tag
      const cacheKeys = await this.driver.smembers(tagKey);

      if (cacheKeys.length === 0) {
        // Delete empty tag set
        await this.driver.del(tagKey);
        return 0;
      }

      // Cluster-safe: delete keys individually to avoid CROSSSLOT errors
      // In standalone/sentinel mode this is slightly slower but works everywhere
      let deletedCount = 0;

      // Delete in batches to avoid blocking Redis for too long
      const batchSize = TAG_BATCH_SIZE;
      for (let i = 0; i < cacheKeys.length; i += batchSize) {
        const batch = cacheKeys.slice(i, i + batchSize);

        // Delete each key individually (cluster-safe)
        const results = await Promise.all(batch.map((key) => this.driver.del(key)));

        deletedCount += results.reduce((sum, result) => sum + result, 0);
      }

      // Delete the tag set itself
      await this.driver.del(tagKey);

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
      // Validate tags using Tags VO
      const validatedTags = this.validateTags(tags);

      let totalInvalidated = 0;

      for (const tag of validatedTags) {
        const count = await this.invalidateTag(tag);
        totalInvalidated += count;
      }

      return totalInvalidated;
    } catch (error) {
      throw new TagInvalidationError(tags[0] ?? 'unknown', `Failed to invalidate tags [${tags.join(', ')}]: ${(error as Error).message}`, error as Error);
    }
  }

  async clearAllTags(): Promise<void> {
    try {
      const pattern = `${this.tagPrefix}*`;
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) {
        return;
      }

      // Cluster-safe: delete keys individually
      const batchSize = TAG_BATCH_SIZE;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);

        // Delete each key individually to avoid CROSSSLOT errors
        await Promise.all(batch.map((key) => this.driver.del(key)));
      }
    } catch (error) {
      throw new TagInvalidationError('_all', `Failed to clear all tags: ${(error as Error).message}`, error as Error);
    }
  }

  async getTagStats(tag: string): Promise<{ keyCount: number; exists: boolean }> {
    try {
      // Validate tag using Tag VO
      const validTag = Tag.create(tag);
      const tagKey = this.buildTagKey(validTag.toString());
      const exists = (await this.driver.exists(tagKey)) > 0;
      const keyCount = exists ? await this.driver.scard(tagKey) : 0;

      return { keyCount, exists };
    } catch {
      return { keyCount: 0, exists: false };
    }
  }

  /**
   * Validates tags using Tags value object.
   *
   * @param tags - Array of tag strings
   * @returns Array of validated tag strings
   * @throws CacheError if validation fails
   * @private
   */
  private validateTags(tags: string[]): string[] {
    const maxTags = this.options.tags?.maxTagsPerKey ?? 10;
    const tagsVo = Tags.create(tags, maxTags);
    return tagsVo.toStrings();
  }

  private buildTagKey(tag: string): string {
    return `${this.tagPrefix}${tag}`;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = 0;

    do {
      const result = await this.driver.scan(cursor, {
        match: pattern,
        count: TAG_BATCH_SIZE,
      });
      cursor = parseInt(result[0], 10);
      keys.push(...result[1]);
    } while (cursor !== 0);

    return keys;
  }
}
