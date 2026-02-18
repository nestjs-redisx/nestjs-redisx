/**
 * Main cache service implementation.
 * Orchestrates L1/L2 caching with stampede protection, SWR, and tag invalidation.
 */

import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver, ErrorCode } from '@nestjs-redisx/core';

import { L1_CACHE_STORE, L2_CACHE_STORE, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, CACHE_PLUGIN_OPTIONS } from '../../../shared/constants';
import { CacheError, CacheKeyError } from '../../../shared/errors';
import { CacheSetOptions, CacheGetOrSetOptions, CacheStats, ICachePluginOptions } from '../../../shared/types';
import { IStampedeProtection } from '../../../stampede/application/ports/stampede-protection.port';
import { ISwrManager } from '../../../swr/application/ports/swr-manager.port';
import { ITagIndex } from '../../../tags/application/ports/tag-index.port';
import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';
import { CacheKey } from '../../domain/value-objects/cache-key.vo';
import { Tag } from '../../domain/value-objects/tag.vo';
import { Tags } from '../../domain/value-objects/tags.vo';
import { TTL } from '../../domain/value-objects/ttl.vo';
import { ICacheService } from '../ports/cache-service.port';
import { IL1CacheStore } from '../ports/l1-cache-store.port';
import { IL2CacheStore } from '../ports/l2-cache-store.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

// Optional tracing integration
const TRACING_SERVICE = Symbol.for('TRACING_SERVICE');

interface ISpan {
  setAttribute(key: string, value: unknown): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  setStatus(status: 'OK' | 'ERROR'): this;
  recordException(error: Error): this;
  end(): void;
}

interface ITracingService {
  startSpan(name: string, options?: { kind?: string; attributes?: Record<string, unknown> }): ISpan;
}

@Injectable()
export class CacheService implements ICacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly l1Enabled: boolean;
  private readonly l2Enabled: boolean;
  private readonly stampedeEnabled: boolean;
  private readonly swrEnabled: boolean;
  private readonly tagsEnabled: boolean;

  private readonly keyPrefix: string;

  constructor(
    @Inject(REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(L1_CACHE_STORE) private readonly l1Store: IL1CacheStore,
    @Inject(L2_CACHE_STORE) private readonly l2Store: IL2CacheStore,
    @Inject(STAMPEDE_PROTECTION) private readonly stampede: IStampedeProtection,
    @Inject(TAG_INDEX) private readonly tagIndex: ITagIndex,
    @Inject(SWR_MANAGER) private readonly swrManager: ISwrManager,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly options: ICachePluginOptions,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
    @Optional() @Inject(TRACING_SERVICE) private readonly tracing?: ITracingService,
  ) {
    this.l1Enabled = options.l1?.enabled ?? true;
    this.l2Enabled = options.l2?.enabled ?? true;
    this.keyPrefix = options.l2?.keyPrefix ?? 'cache:';
    this.stampedeEnabled = options.stampede?.enabled ?? true;
    this.swrEnabled = options.swr?.enabled ?? false;
    this.tagsEnabled = options.tags?.enabled ?? true;
  }

  async get<T>(key: string): Promise<T | null> {
    const span = this.tracing?.startSpan('cache.get', {
      kind: 'INTERNAL',
      attributes: { 'cache.key': key },
    });

    try {
      // Validate and normalize key (fail-open on validation error)
      const normalizedKey = this.validateAndNormalizeKey(key);
      const enrichedKey = this.enrichKeyWithContext(normalizedKey);

      // Try L1 first
      if (this.l1Enabled) {
        const l1Entry = await this.l1Store.get<T>(enrichedKey);
        if (l1Entry) {
          this.logger.debug(`L1 hit for key: ${key}`);
          this.metrics?.incrementCounter('redisx_cache_hits_total', { layer: 'l1' });
          span?.setAttribute('cache.hit', true);
          span?.setAttribute('cache.layer', 'l1');
          span?.setStatus('OK');
          return l1Entry.value;
        }
        this.metrics?.incrementCounter('redisx_cache_misses_total', { layer: 'l1' });
      }

      // Try L2
      if (this.l2Enabled) {
        const l2Entry = await this.l2Store.get<T>(enrichedKey);
        if (l2Entry) {
          this.logger.debug(`L2 hit for key: ${key}`);
          this.metrics?.incrementCounter('redisx_cache_hits_total', { layer: 'l2' });
          span?.setAttribute('cache.hit', true);
          span?.setAttribute('cache.layer', 'l2');
          span?.setStatus('OK');

          // Populate L1
          if (this.l1Enabled) {
            await this.l1Store.set(enrichedKey, l2Entry, this.options.l1?.ttl);
          }

          return l2Entry.value;
        }
        this.metrics?.incrementCounter('redisx_cache_misses_total', { layer: 'l2' });
      }

      span?.setAttribute('cache.hit', false);
      span?.setStatus('OK');
      return null;
    } catch (error) {
      // Fail-open: log and return null (includes validation errors)
      if (error instanceof CacheKeyError) {
        this.logger.warn(`Invalid cache key "${key}": ${error.message}`);
      } else {
        this.logger.error(`Cache get failed for key ${key}:`, error);
      }
      span?.recordException(error as Error);
      span?.setStatus('ERROR');
      return null;
    } finally {
      span?.end();
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    const span = this.tracing?.startSpan('cache.set', {
      kind: 'INTERNAL',
      attributes: { 'cache.key': key, 'cache.ttl': options.ttl },
    });

    try {
      // Validate and normalize key (fail-closed - throw on validation error)
      const normalizedKey = this.validateAndNormalizeKey(key);
      const enrichedKey = this.enrichKeyWithContext(normalizedKey, options.varyBy);

      // Validate TTL using TTL value object
      const ttlSeconds = options.ttl ?? this.options.l2?.defaultTtl ?? 3600;
      const maxTtl = this.options.l2?.maxTtl ?? 86400;
      const ttl = TTL.create(ttlSeconds, maxTtl);

      const entry = CacheEntry.create(value, ttl.toSeconds());

      // Determine cache strategy
      const strategy = options.strategy ?? 'l1-l2';
      span?.setAttribute('cache.strategy', strategy);

      // Set in L2 (if not l1-only)
      if (this.l2Enabled && strategy !== 'l1-only') {
        await this.l2Store.set(enrichedKey, entry, ttl.toSeconds());
      }

      // Set in L1 (if not l2-only, use minimum of L2 TTL and L1 max TTL)
      if (this.l1Enabled && strategy !== 'l2-only') {
        const l1MaxTtl = TTL.create(this.options.l1?.ttl ?? 60, maxTtl);
        const l1Ttl = TTL.min(ttl, l1MaxTtl);
        await this.l1Store.set(enrichedKey, entry, l1Ttl.toSeconds());
      }

      // Add to tag index (only for L2 operations, use full key with prefix)
      if (this.tagsEnabled && options.tags && options.tags.length > 0 && strategy !== 'l1-only') {
        const fullKey = `${this.keyPrefix}${enrichedKey}`;
        await this.tagIndex.addKeyToTags(fullKey, options.tags);
        span?.setAttribute('cache.tags', options.tags.join(','));
      }

      span?.setStatus('OK');
    } catch (error) {
      span?.recordException(error as Error);
      span?.setStatus('ERROR');
      // CacheKeyError and CacheError (from TTL validation) will be thrown as-is
      if (error instanceof CacheKeyError || error instanceof CacheError) {
        throw error;
      }
      throw new CacheError(`Failed to set cache for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_SET_FAILED, error as Error);
    } finally {
      span?.end();
    }
  }

  async getOrSet<T>(key: string, loader: () => Promise<T>, options: CacheGetOrSetOptions = {}): Promise<T> {
    // Validate key early (fail-closed for write operations)
    const normalizedKey = this.validateAndNormalizeKey(key);
    const enrichedKey = this.enrichKeyWithContext(normalizedKey, options.varyBy);

    // Check if SWR is enabled for this call
    const swrEnabled = options.swr?.enabled ?? this.swrEnabled;

    if (swrEnabled) {
      // SWR flow
      const swrEntry = await this.l2Store.getSwr<T>(enrichedKey);

      if (swrEntry) {
        const isExpired = this.swrManager.isExpired(swrEntry);

        if (!isExpired) {
          // Data is valid (fresh or stale)
          const isStale = this.swrManager.isStale(swrEntry);

          if (isStale && this.swrManager.shouldRevalidate(enrichedKey)) {
            // Trigger background revalidation
            void this.swrManager.scheduleRevalidation(
              enrichedKey,
              loader,
              async (freshValue) => {
                // Write proper SWR entry (not CacheEntry) to preserve staleAt/expiresAt metadata
                const staleTime = options.swr?.staleTime ?? this.options.swr?.defaultStaleTime ?? 60;
                const ttl = options.ttl ?? this.options.l2?.defaultTtl ?? 3600;
                const swrEntryNew = this.swrManager.createSwrEntry(freshValue, ttl, staleTime);
                await this.l2Store.setSwr(enrichedKey, swrEntryNew);

                // Also update L1 for fast reads
                if (this.l1Enabled) {
                  const entry = CacheEntry.create(freshValue, ttl);
                  await this.l1Store.set(enrichedKey, entry, this.options.l1?.ttl);
                }
              },
              (error) => {
                this.logger.error(`SWR revalidation failed for key ${enrichedKey}:`, error);
              },
            );
          }

          return swrEntry.value;
        }
      }

      // SWR miss or expired - load and cache with SWR metadata
      const value = await this.loadWithStampede(enrichedKey, loader, options);

      if (!options.unless?.(value)) {
        const staleTime = options.swr?.staleTime ?? this.options.swr?.defaultStaleTime ?? 60;
        const ttl = options.ttl ?? this.options.l2?.defaultTtl ?? 3600;
        const swrEntryNew = this.swrManager.createSwrEntry(value, ttl, staleTime);

        await this.l2Store.setSwr(enrichedKey, swrEntryNew);
      }

      return value;
    }

    // Regular flow (no SWR) — use enrichedKey directly to avoid double-enrichment
    const cached = await this.get<T>(enrichedKey);
    if (cached !== null) {
      return cached;
    }

    return this.loadWithStampede(enrichedKey, loader, options);
  }

  /**
   * Loads value with stampede protection if enabled.
   *
   * @param key - Normalized cache key
   * @param loader - Function to load value
   * @param options - Cache options
   * @returns Loaded value
   * @private
   */
  private async loadWithStampede<T>(key: string, loader: () => Promise<T>, options: CacheGetOrSetOptions): Promise<T> {
    if (this.stampedeEnabled && !options.skipStampede) {
      const result = await this.stampede.protect(key, loader);

      if (result.cached) {
        // Stampede was prevented - another request loaded the value
        this.metrics?.incrementCounter('redisx_cache_stampede_prevented_total');
        return result.value;
      }

      if (!options.unless?.(result.value)) {
        await this.set(key, result.value, {
          ttl: options.ttl,
          tags: options.tags,
          strategy: options.strategy,
        });
      }

      return result.value;
    }

    // No stampede protection - direct load
    const value = await loader();

    if (!options.unless?.(value)) {
      await this.set(key, value, {
        ttl: options.ttl,
        tags: options.tags,
        strategy: options.strategy,
      });
    }

    return value;
  }

  async delete(key: string): Promise<boolean> {
    try {
      // Validate key (fail-closed for write operations)
      const normalizedKey = this.validateAndNormalizeKey(key);
      const enrichedKey = this.enrichKeyWithContext(normalizedKey);

      let deleted = false;

      if (this.l1Enabled) {
        const l1Deleted = await this.l1Store.delete(enrichedKey);
        deleted = deleted || l1Deleted;
      }

      if (this.l2Enabled) {
        const l2Deleted = await this.l2Store.delete(enrichedKey);
        deleted = deleted || l2Deleted;
      }

      return deleted;
    } catch (error) {
      // CacheKeyError will be thrown as-is
      if (error instanceof CacheKeyError) {
        throw error;
      }
      throw new CacheError(`Failed to delete cache for key "${key}": ${(error as Error).message}`, ErrorCode.CACHE_DELETE_FAILED, error as Error);
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    try {
      // Validate, normalize, and enrich all keys (fail-closed for write operations)
      const normalizedKeys = keys
        .map((key) => {
          try {
            const normalized = this.validateAndNormalizeKey(key);
            return this.enrichKeyWithContext(normalized);
          } catch (error) {
            if (error instanceof CacheKeyError) {
              this.logger.warn(`Invalid key in deleteMany "${key}": ${error.message}`);
            }
            return null;
          }
        })
        .filter((k): k is string => k !== null);

      if (normalizedKeys.length === 0) {
        return 0;
      }

      let deletedCount = 0;

      // Delete from L1
      if (this.l1Enabled) {
        for (const key of normalizedKeys) {
          const deleted = await this.l1Store.delete(key);
          if (deleted) deletedCount++;
        }
      }

      // Delete from L2 using pipeline for batch operation
      if (this.l2Enabled && normalizedKeys.length > 0) {
        const fullKeys = normalizedKeys.map((k) => `${this.keyPrefix}${k}`);
        const pipeline = this.driver.pipeline();

        for (const fullKey of fullKeys) {
          pipeline.del(fullKey);
        }

        const results = await pipeline.exec();

        // Count successful deletions from L2
        let l2Count = 0;
        if (results) {
          for (const [error, result] of results) {
            if (!error && typeof result === 'number' && result > 0) {
              l2Count++;
            }
          }
        }

        // Use maximum of L1 and L2 counts
        deletedCount = Math.max(deletedCount, l2Count);
      }

      return deletedCount;
    } catch (error) {
      throw new CacheError(`Failed to delete multiple keys: ${(error as Error).message}`, ErrorCode.CACHE_DELETE_FAILED, error as Error);
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.l1Enabled) {
        await this.l1Store.clear();
      }

      if (this.l2Enabled) {
        await this.l2Store.clear();
      }

      if (this.tagsEnabled) {
        await this.tagIndex.clearAllTags();
      }
    } catch (error) {
      throw new CacheError(`Failed to clear cache: ${(error as Error).message}`, ErrorCode.CACHE_CLEAR_FAILED, error as Error);
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      // Validate key (fail-open for read operations)
      const normalizedKey = this.validateAndNormalizeKey(key);
      const enrichedKey = this.enrichKeyWithContext(normalizedKey);

      if (this.l1Enabled) {
        const l1Has = await this.l1Store.has(enrichedKey);
        if (l1Has) return true;
      }

      if (this.l2Enabled) {
        return await this.l2Store.has(enrichedKey);
      }

      return false;
    } catch (error) {
      // Fail-open (includes validation errors)
      if (error instanceof CacheKeyError) {
        this.logger.warn(`Invalid cache key "${key}": ${error.message}`);
      }
      return false;
    }
  }

  async invalidateTag(tag: string): Promise<number> {
    if (!this.tagsEnabled) {
      return 0;
    }

    try {
      // Get all keys for this tag (keys include L2 prefix)
      const keysWithPrefix = await this.tagIndex.getKeysByTag(tag);

      // Delete from L1 (needs keys without prefix)
      if (this.l1Enabled) {
        const keysWithoutPrefix = keysWithPrefix.map((key) => (key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key));
        await Promise.all(keysWithoutPrefix.map((key) => this.l1Store.delete(key)));
      }

      // Delete from L2 and tag index (handled by tagIndex.invalidateTag)
      return await this.tagIndex.invalidateTag(tag);
    } catch (error) {
      throw new CacheError(`Failed to invalidate tag "${tag}": ${(error as Error).message}`, ErrorCode.CACHE_TAG_INVALIDATION_FAILED, error as Error);
    }
  }

  async invalidateTags(tags: string[]): Promise<number> {
    if (!this.tagsEnabled || tags.length === 0) {
      return 0;
    }

    try {
      let total = 0;
      for (const tag of tags) {
        const count = await this.invalidateTag(tag);
        total += count;
      }
      return total;
    } catch (error) {
      throw new CacheError(`Failed to invalidate tags: ${(error as Error).message}`, ErrorCode.CACHE_TAG_INVALIDATION_FAILED, error as Error);
    }
  }

  async getKeysByTag(tag: string): Promise<string[]> {
    if (!this.tagsEnabled) {
      return [];
    }

    try {
      // Validate tag using Tag VO
      const validTag = Tag.create(tag);
      const keysWithPrefix = await this.tagIndex.getKeysByTag(validTag.toString());

      // Remove L2 prefix from keys
      return keysWithPrefix.map((key) => (key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key));
    } catch (error) {
      // Fail-open: log and return empty array
      this.logger.error(`Failed to get keys for tag ${tag}:`, error);
      return [];
    }
  }

  async getMany<T>(keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) {
      return [];
    }

    try {
      // Validate, normalize, and enrich all keys (fail-open)
      const normalizedKeys = keys.map((key) => {
        try {
          const normalized = this.validateAndNormalizeKey(key);
          return this.enrichKeyWithContext(normalized);
        } catch (error) {
          if (error instanceof CacheKeyError) {
            this.logger.warn(`Invalid cache key in getMany "${key}": ${error.message}`);
          }
          return null;
        }
      });

      // For simplicity, get from L2 only for getMany
      if (!this.l2Enabled) {
        return keys.map(() => null);
      }

      // Filter out null keys (validation failures) and maintain index mapping
      const validKeys: string[] = [];
      const indexMap: Map<number, number> = new Map();
      normalizedKeys.forEach((key, index) => {
        if (key !== null) {
          indexMap.set(validKeys.length, index);
          validKeys.push(key);
        }
      });

      if (validKeys.length === 0) {
        return keys.map(() => null);
      }

      const entries = await this.l2Store.getMany<T>(validKeys);

      // Reconstruct result array with null for invalid keys
      const result: Array<T | null> = keys.map(() => null);
      entries.forEach((entry, validIndex) => {
        const originalIndex = indexMap.get(validIndex);
        if (originalIndex !== undefined) {
          result[originalIndex] = entry ? entry.value : null;
        }
      });

      return result;
    } catch (error) {
      // Fail-open
      this.logger.error('Failed to getMany:', error);
      return keys.map(() => null);
    }
  }

  async setMany<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    try {
      if (!this.l2Enabled) {
        return;
      }

      // Validate, normalize, and enrich all keys (fail-closed for write operations)
      const maxTtl = this.options.l2?.maxTtl ?? 86400;
      const defaultTtl = this.options.l2?.defaultTtl ?? 3600;
      const cacheEntries = entries.map(({ key, value, ttl }) => {
        const entryTtl = Math.min(ttl ?? defaultTtl, maxTtl);
        return {
          key: this.enrichKeyWithContext(this.validateAndNormalizeKey(key)),
          entry: CacheEntry.create(value, entryTtl),
          ttl: entryTtl,
        };
      });

      await this.l2Store.setMany(cacheEntries);

      // Add tags to tag index for entries that have tags
      if (this.tagsEnabled) {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          const { tags } = entry;
          if (tags && tags.length > 0) {
            const enrichedKey = cacheEntries[i]!.key;
            const fullKey = `${this.keyPrefix}${enrichedKey}`;
            const validatedTags = Tags.create(tags).toStrings();
            await this.tagIndex.addKeyToTags(fullKey, validatedTags);
          }
        }
      }
    } catch (error) {
      // CacheKeyError will be thrown as-is
      if (error instanceof CacheKeyError) {
        throw error;
      }
      throw new CacheError(`Failed to setMany: ${(error as Error).message}`, ErrorCode.CACHE_SET_FAILED, error as Error);
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.l2Enabled) {
      return -1;
    }

    try {
      // Validate key (fail-open for read operations)
      const normalizedKey = this.validateAndNormalizeKey(key);
      const enrichedKey = this.enrichKeyWithContext(normalizedKey);
      return await this.l2Store.ttl(enrichedKey);
    } catch (error) {
      // Fail-open (includes validation errors)
      if (error instanceof CacheKeyError) {
        this.logger.warn(`Invalid cache key "${key}": ${error.message}`);
      }
      return -1;
    }
  }

  async getStats(): Promise<CacheStats> {
    const l1Stats = this.l1Enabled ? this.l1Store.getStats() : { hits: 0, misses: 0, size: 0 };
    const l2Stats = this.l2Enabled ? await this.l2Store.getStats() : { hits: 0, misses: 0 };
    const stampedeStats = this.stampedeEnabled ? this.stampede.getStats() : { activeFlights: 0, totalWaiters: 0, oldestFlight: 0, prevented: 0 };

    return {
      l1: l1Stats,
      l2: l2Stats,
      stampedePrevented: stampedeStats.prevented,
    };
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    if (!this.l2Enabled) {
      return 0;
    }

    try {
      // Use SCAN to find matching keys
      const result = await this.l2Store.scan(pattern);
      const keys = result.keys;

      if (keys.length === 0) {
        return 0;
      }

      // Delete from L1
      if (this.l1Enabled) {
        const keysWithoutPrefix = keys.map((key) => (key.startsWith(this.keyPrefix) ? key.slice(this.keyPrefix.length) : key));
        await Promise.all(keysWithoutPrefix.map((key) => this.l1Store.delete(key)));
      }

      // Delete from L2
      let deleted = 0;
      for (const key of keys) {
        const wasDeleted = await this.l2Store.delete(key);
        if (wasDeleted) {
          deleted++;
        }
      }

      return deleted;
    } catch (error) {
      throw new CacheError(`Failed to invalidate by pattern "${pattern}": ${(error as Error).message}`, ErrorCode.CACHE_DELETE_FAILED, error as Error);
    }
  }

  /**
   * Validates and normalizes cache key using CacheKey value object.
   *
   * @param rawKey - Raw key string
   * @returns Normalized key string (without prefix - prefix added by L2 store)
   * @throws CacheKeyError if validation fails
   *
   * @private
   */
  private validateAndNormalizeKey(rawKey: string): string {
    try {
      const keyOptions = {
        maxLength: this.options.keys?.maxLength ?? 1024,
        version: this.options.keys?.version,
        separator: this.options.keys?.separator ?? ':',
        // Don't include prefix here - it's added by L2 store
        prefix: '',
      };

      const cacheKey = CacheKey.create(rawKey, keyOptions);

      // Return raw key without prefix (L2 store will add its prefix)
      return cacheKey.getRaw();
    } catch (error) {
      if (error instanceof CacheKeyError) {
        throw error;
      }
      throw new CacheKeyError(rawKey, `Invalid cache key: ${(error as Error).message}`);
    }
  }

  /**
   * Enriches a normalized key with context values.
   * Appends global context keys and per-call varyBy values as key suffix.
   * Uses a marker (_ctx_) to prevent double-enrichment in internal call chains.
   *
   * @param normalizedKey - Already validated and normalized cache key
   * @param varyBy - Optional per-call context overrides
   * @returns Enriched key with context suffix, or original key if no context
   * @private
   */
  private enrichKeyWithContext(normalizedKey: string, varyBy?: Record<string, string>): string {
    const separator = this.options.keys?.separator ?? ':';
    const marker = `${separator}_ctx_${separator}`;

    // Skip if already enriched (prevents double-enrichment in internal calls)
    if (normalizedKey.includes(marker)) {
      return normalizedKey;
    }

    const contextProvider = this.options.contextProvider;
    const contextKeys = this.options.contextKeys;
    const contextMap = new Map<string, string>();

    // Global context keys (from contextProvider)
    if (contextProvider && contextKeys && contextKeys.length > 0) {
      for (const ctxKey of contextKeys) {
        const value = contextProvider.get<string>(ctxKey);
        if (value !== undefined && value !== null) {
          if (typeof value === 'object') {
            this.logger.warn(`Context key "${ctxKey}" has object value, skipping (use primitives for context keys)`);
            continue;
          }
          contextMap.set(ctxKey, String(value));
        }
      }
    }

    // Per-call varyBy (overrides global context values)
    if (varyBy) {
      for (const [k, v] of Object.entries(varyBy)) {
        contextMap.set(k, v);
      }
    }

    if (contextMap.size === 0) return normalizedKey;

    const sortedEntries = [...contextMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    const suffix = sortedEntries.map(([k, v]) => `${this.sanitizeForKey(k)}.${this.sanitizeForKey(v)}`).join(separator);

    return `${normalizedKey}${marker}${suffix}`;
  }

  /**
   * Sanitizes a value for use in cache key (removes non-allowed characters).
   * @private
   */
  private sanitizeForKey(value: string): string {
    return String(value).replace(/[^a-zA-Z0-9\-_]/g, '_');
  }
}
