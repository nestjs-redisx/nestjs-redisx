/**
 * L2 Redis cache store implementation.
 */

import { Injectable, Inject } from '@nestjs/common';
import { IRedisDriver, ErrorCode } from '@nestjs-redisx/core';

import { CACHE_REDIS_DRIVER, CACHE_PLUGIN_OPTIONS, SERIALIZER } from '../../../shared/constants';
import { CacheError } from '../../../shared/errors';
import { ICachePluginOptions, ScanResult, SwrEntry } from '../../../shared/types';
import { IL2CacheStore } from '../../application/ports/l2-cache-store.port';
import { Serializer } from '../../domain/services/serializer.service';
import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';

/** Default batch size for SCAN and bulk delete operations. */
const DEFAULT_BATCH_SIZE = 100;

@Injectable()
export class L2RedisStoreAdapter implements IL2CacheStore {
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(
    @Inject(CACHE_REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly options: ICachePluginOptions,
    @Inject(SERIALIZER) private readonly serializer: Serializer,
  ) {
    this.keyPrefix = options.l2?.keyPrefix ?? 'cache:';
    this.defaultTtl = options.l2?.defaultTtl ?? 3600;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const fullKey = this.buildKey(key);
      const value = await this.driver.get(fullKey);

      if (!value) {
        this.misses++;
        return null;
      }

      this.hits++;
      return this.serializer.deserialize<CacheEntry<T>>(value);
    } catch {
      // Fail-open: return null on error
      this.misses++;
      return null;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    try {
      const fullKey = this.buildKey(key);
      const serialized = this.serializer.serialize(entry);
      const ttlSeconds = ttl ?? this.defaultTtl;

      await this.driver.setex(fullKey, ttlSeconds, serialized);
    } catch (error) {
      throw new CacheError(`Failed to set cache entry for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_SET_FAILED, error as Error);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const result = await this.driver.del(fullKey);
      return result > 0;
    } catch (error) {
      throw new CacheError(`Failed to delete cache entry for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_DELETE_FAILED, error as Error);
    }
  }

  async clear(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) {
        return;
      }

      // Cluster-safe: delete keys individually to avoid CROSSSLOT errors
      const batchSize = DEFAULT_BATCH_SIZE;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);

        // Delete each key individually
        await Promise.all(batch.map((key) => this.driver.del(key)));
      }
    } catch (error) {
      throw new CacheError(`Failed to clear cache: ${(error as Error).message}`, ErrorCode.CACHE_CLEAR_FAILED, error as Error);
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const exists = await this.driver.exists(fullKey);
      return exists > 0;
    } catch {
      // Fail-open: return false on error
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      const fullKey = this.buildKey(key);
      const ttl = await this.driver.ttl(fullKey);
      return ttl;
    } catch {
      return -1;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const result = await this.driver.expire(fullKey, ttl);
      return result === 1;
    } catch (error) {
      throw new CacheError(`Failed to set expiration for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_OPERATION_FAILED, error as Error);
    }
  }

  async scan(pattern: string, count: number = DEFAULT_BATCH_SIZE): Promise<ScanResult> {
    try {
      const fullPattern = `${this.keyPrefix}${pattern}`;
      const keys = await this.scanKeys(fullPattern, count);

      // Remove prefix from keys
      const strippedKeys = keys.map((key) => (key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key));

      return {
        keys: strippedKeys,
        cursor: '0', // Simplified: full scan completed
      };
    } catch (error) {
      throw new CacheError(`Failed to scan keys with pattern "${pattern}": ${(error as Error).message}`, ErrorCode.CACHE_OPERATION_FAILED, error as Error);
    }
  }

  async getMany<T>(keys: string[]): Promise<Array<CacheEntry<T> | null>> {
    try {
      if (keys.length === 0) {
        return [];
      }

      const fullKeys = keys.map((key) => this.buildKey(key));

      // Use driver.mget() - core handles cluster topology automatically
      const values = await this.driver.mget(...fullKeys);

      return values.map((value) => {
        if (!value) {
          this.misses++;
          return null;
        }
        this.hits++;
        return this.serializer.tryDeserialize<CacheEntry<T>>(value);
      });
    } catch {
      // Fail-open: return array of nulls
      return keys.map(() => null);
    }
  }

  async setMany<T>(entries: Array<{ key: string; entry: CacheEntry<T>; ttl?: number }>): Promise<void> {
    try {
      if (entries.length === 0) {
        return;
      }

      // Cluster-safe: set keys individually to avoid CROSSSLOT errors with pipeline
      // In standalone mode this is slightly slower but works everywhere
      await Promise.all(
        entries.map(async ({ key, entry, ttl }) => {
          const fullKey = this.buildKey(key);
          const serialized = this.serializer.serialize(entry);
          const ttlSeconds = ttl ?? this.defaultTtl;

          await this.driver.setex(fullKey, ttlSeconds, serialized);
        }),
      );
    } catch (error) {
      throw new CacheError(`Failed to set multiple cache entries: ${(error as Error).message}`, ErrorCode.CACHE_SET_FAILED, error as Error);
    }
  }

  private buildKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async scanKeys(pattern: string, count: number = DEFAULT_BATCH_SIZE): Promise<string[]> {
    const keys: string[] = [];
    let cursor = 0;

    do {
      const result = await this.driver.scan(cursor, {
        match: pattern,
        count,
      });
      cursor = parseInt(result[0], 10);
      keys.push(...result[1]);
    } while (cursor !== 0);

    return keys;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStats(): Promise<{ hits: number; misses: number }> {
    return {
      hits: this.hits,
      misses: this.misses,
    };
  }

  async getSwr<T>(key: string): Promise<SwrEntry<T> | null> {
    try {
      const fullKey = this.buildKey(key);
      const value = await this.driver.get(fullKey);

      if (!value) {
        this.misses++;
        return null;
      }

      this.hits++;
      return this.serializer.deserialize<SwrEntry<T>>(value);
    } catch {
      // Fail-open: return null on error
      this.misses++;
      return null;
    }
  }

  async setSwr<T>(key: string, swrEntry: SwrEntry<T>): Promise<void> {
    try {
      const fullKey = this.buildKey(key);
      const serialized = this.serializer.serialize(swrEntry);

      // Calculate TTL from expiresAt timestamp
      const now = Date.now();
      const ttlMs = swrEntry.expiresAt - now;

      if (ttlMs <= 0) {
        // Entry already expired, don't save it
        return;
      }

      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

      await this.driver.setex(fullKey, ttlSeconds, serialized);
    } catch (error) {
      throw new CacheError(`Failed to set SWR entry for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_SET_FAILED, error as Error);
    }
  }
}
