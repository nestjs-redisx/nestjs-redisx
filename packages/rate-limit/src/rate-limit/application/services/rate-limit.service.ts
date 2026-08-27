import { Injectable, Inject, Optional } from '@nestjs/common';

import { RATE_LIMIT_MEMORY_STORE, RATE_LIMIT_PLUGIN_OPTIONS, RATE_LIMIT_STORE } from '../../../shared/constants';
import { InvalidRateLimitConfigError, RateLimitScriptError } from '../../../shared/errors';
import { IRateLimitPluginOptions, IRateLimitConfig, IRateLimitResetOptions, IRateLimitResult, IRateLimitState, RateLimitStoreType } from '../../../shared/types';
import { validateStoreType } from '../../../shared/utils/validate-store-options';
import { IRateLimitService } from '../ports/rate-limit-service.port';
import { IRateLimitStore } from '../ports/rate-limit-store.port';

/**
 * Rate limit service implementation.
 * Provides rate limiting operations with multiple algorithms over two
 * interchangeable stores: distributed (redis) and per-instance (memory).
 */
@Injectable()
export class RateLimitService implements IRateLimitService {
  constructor(
    @Inject(RATE_LIMIT_PLUGIN_OPTIONS)
    private readonly config: IRateLimitPluginOptions,
    @Inject(RATE_LIMIT_STORE)
    private readonly store: IRateLimitStore,
    @Optional()
    @Inject(RATE_LIMIT_MEMORY_STORE)
    private readonly memoryStore?: IRateLimitStore,
  ) {}

  /**
   * Check and consume rate limit.
   */
  async check(key: string, config: IRateLimitConfig = {}): Promise<IRateLimitResult> {
    const algorithm = config.algorithm ?? this.config.defaultAlgorithm ?? 'sliding-window';
    // Include algorithm in key to avoid WRONGTYPE errors when different algorithms
    // use different Redis data types (string, sorted set, hash) for the same key
    const fullKey = this.buildKey(key, algorithm);
    // Resolved OUTSIDE the try block: configuration errors are fail-fast and
    // must never be masked by errorPolicy 'fail-open'.
    const store = this.resolveStore(config.store);

    try {
      switch (algorithm) {
        case 'fixed-window':
          return await this.checkFixedWindow(store, fullKey, config);
        case 'sliding-window':
          return await this.checkSlidingWindow(store, fullKey, config);
        case 'token-bucket':
          return await this.checkTokenBucket(store, fullKey, config);
        default:
          throw new Error(`Unknown algorithm: ${algorithm}`);
      }
    } catch (error) {
      return this.handleError(error as Error, config);
    }
  }

  /**
   * Check without consuming.
   */
  async peek(key: string, config: IRateLimitConfig = {}): Promise<IRateLimitResult> {
    const algorithm = config.algorithm ?? this.config.defaultAlgorithm ?? 'sliding-window';
    const fullKey = this.buildKey(key, algorithm);
    const store = this.resolveStore(config.store);

    try {
      const storeConfig = this.buildStoreConfig(algorithm, config);
      return await store.peek(fullKey, algorithm, storeConfig);
    } catch (error) {
      return this.handleError(error as Error, config);
    }
  }

  /**
   * Reset rate limit for key.
   * Resets all algorithm variants (fixed-window, sliding-window, token-bucket).
   * With no store targeting, BOTH stores are swept: the service cannot know
   * which store a key was counted in. Memory-store resets are per-instance.
   */
  async reset(key: string, options: IRateLimitResetOptions = {}): Promise<void> {
    validateStoreType(options.store, 'reset options');

    const stores: IRateLimitStore[] = [];
    if (options.store === undefined) {
      stores.push(this.store);
      if (this.memoryStore) {
        stores.push(this.memoryStore);
      }
    } else {
      stores.push(this.resolveStore(options.store));
    }

    const algorithms = ['fixed-window', 'sliding-window', 'token-bucket'] as const;
    await Promise.all(stores.flatMap((store) => algorithms.map((algo) => store.reset(this.buildKey(key, algo)))));
  }

  /**
   * Get current state.
   */
  async getState(key: string, config: IRateLimitConfig = {}): Promise<IRateLimitState> {
    const result = await this.peek(key, config);

    return {
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: new Date(result.reset * 1000),
    };
  }

  /**
   * Resolve the store for a call: per-call override -> plugin default -> redis.
   * Configuration errors here are fail-fast (never subject to errorPolicy).
   */
  private resolveStore(override: RateLimitStoreType | undefined): IRateLimitStore {
    validateStoreType(override, 'rate limit config');
    const storeType = override ?? this.config.store ?? 'redis';

    if (storeType === 'memory') {
      if (!this.memoryStore) {
        throw new InvalidRateLimitConfigError('The in-memory rate limit store is not available. It is registered automatically by RateLimitPlugin; when constructing RateLimitService manually, pass an InMemoryRateLimitStoreAdapter as the third argument.');
      }
      return this.memoryStore;
    }

    return this.store;
  }

  /**
   * Check fixed window rate limit.
   */
  private async checkFixedWindow(store: IRateLimitStore, key: string, config: IRateLimitConfig): Promise<IRateLimitResult> {
    const points = config.points ?? this.config.defaultPoints ?? 100;
    const duration = config.duration ?? this.config.defaultDuration ?? 60;

    return await store.fixedWindow(key, points, duration);
  }

  /**
   * Check sliding window rate limit.
   */
  private async checkSlidingWindow(store: IRateLimitStore, key: string, config: IRateLimitConfig): Promise<IRateLimitResult> {
    const points = config.points ?? this.config.defaultPoints ?? 100;
    const duration = config.duration ?? this.config.defaultDuration ?? 60;

    return await store.slidingWindow(key, points, duration);
  }

  /**
   * Check token bucket rate limit.
   */
  private async checkTokenBucket(store: IRateLimitStore, key: string, config: IRateLimitConfig): Promise<IRateLimitResult> {
    const capacity = config.capacity ?? config.points ?? this.config.defaultPoints ?? 100;
    const refillRate = config.refillRate ?? (config.duration ? capacity / config.duration : 10);

    return await store.tokenBucket(key, capacity, refillRate, 1);
  }

  /**
   * Build store configuration.
   */
  private buildStoreConfig(algorithm: string, config: IRateLimitConfig): Record<string, number> {
    const baseConfig = {
      points: config.points ?? this.config.defaultPoints ?? 100,
      duration: config.duration ?? this.config.defaultDuration ?? 60,
    };

    if (algorithm === 'token-bucket') {
      const capacity = config.capacity ?? baseConfig.points;
      const refillRate = config.refillRate ?? capacity / baseConfig.duration;
      return { capacity, refillRate };
    }

    return baseConfig;
  }

  /**
   * Handle error based on error policy.
   */
  private handleError(error: Error, config: IRateLimitConfig): IRateLimitResult {
    const errorPolicy = this.config.errorPolicy ?? 'fail-closed';

    if (errorPolicy === 'fail-open') {
      // Allow request on error (high availability)
      const points = config.points ?? this.config.defaultPoints ?? 100;
      const duration = config.duration ?? this.config.defaultDuration ?? 60;

      return {
        allowed: true,
        limit: points,
        remaining: points,
        reset: Math.floor(Date.now() / 1000) + duration,
        current: 0,
      };
    }

    // Fail-closed: propagate error
    throw new RateLimitScriptError(`Rate limit check failed: ${error.message}`, error);
  }

  /**
   * Build full key with prefix and algorithm.
   * Including algorithm prevents WRONGTYPE errors when different algorithms
   * use different Redis data types for the same logical key.
   */
  private buildKey(key: string, algorithm?: string): string {
    const prefix = this.config.keyPrefix ?? 'rl:';
    const algoPrefix = algorithm ? `${algorithm}:` : '';
    return `${prefix}${algoPrefix}${key}`;
  }
}
