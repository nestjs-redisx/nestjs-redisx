/**
 * Shared types for Cache plugin.
 */

export type { IContextProvider } from './context-provider.interface';

/**
 * Cache plugin configuration.
 */
export interface ICachePluginOptions {
  /** Make module global */
  isGlobal?: boolean; // default: false

  /** Named Redis client to use. @default 'default' */
  client?: string;

  /** L1 in-memory cache config */
  l1?: {
    enabled?: boolean; // default: true
    maxSize?: number; // default: 1000
    ttl?: number; // default: 60 (seconds)
    evictionPolicy?: 'lru' | 'lfu'; // default: 'lru'
  };

  /** L2 Redis cache config */
  l2?: {
    enabled?: boolean; // default: true
    defaultTtl?: number; // default: 3600 (seconds)
    maxTtl?: number; // default: 86400 (24h)
    keyPrefix?: string; // default: 'cache:'
    clientName?: string; // default: 'default'
  };

  /** Stampede protection config */
  stampede?: {
    enabled?: boolean; // default: true
    lockTimeout?: number; // default: 5000 (ms)
    waitTimeout?: number; // default: 10000 (ms)
    fallback?: 'load' | 'error' | 'null'; // default: 'load'
  };

  /** Stale-while-revalidate config */
  swr?: {
    enabled?: boolean; // default: false
    defaultStaleTime?: number; // default: 60 (seconds)
  };

  /**
   * Stale-if-error (RFC 5861): serve the last known value when the loader
   * FAILS, for `defaultWindow` seconds beyond the normal lifetime. Independent
   * of SWR (freshness policy); this is the availability policy. Entries are
   * physically retained until the window ends, so this affects Redis memory
   * only when enabled.
   */
  staleIfError?: {
    /** default: false */
    enabled?: boolean;
    /**
     * Seconds to retain AND serve the value on loader errors, beyond the
     * normal expiry (TTL + SWR staleTime). Always a finite number — for a
     * "practically infinite" outage budget set an explicit large value
     * (e.g. 30 days): an explicit number keeps Redis memory bounded.
     * default: 86400 (24h)
     */
    defaultWindow?: number;
    /**
     * Decides whether a given loader error qualifies for stale serving
     * (default: any error). Use it to EXCLUDE errors that mean the data is
     * gone for good (404/410, revoked access) — serving stale forever on
     * those silently exposes dead data.
     */
    shouldServe?: (error: Error) => boolean;
  };

  /** Tag invalidation config */
  tags?: {
    enabled?: boolean; // default: true
    indexPrefix?: string; // default: '_tag:'
    maxTagsPerKey?: number; // default: 10
    ttl?: number; // default: same as l2.maxTtl (86400)
  };

  /** Cache warming config */
  warmup?: {
    enabled?: boolean; // default: false
    keys?: IWarmupKey[];
    concurrency?: number; // default: 10
  };

  /** Key config */
  keys?: {
    maxLength?: number; // default: 1024
    version?: string; // default: 'v1'
    separator?: string; // default: ':'
    /**
     * Character validation for cache keys.
     * - 'safe' (default): reject only empty/whitespace/control characters —
     *   Redis keys are binary-safe, so `/`, `?`, `=`, `%`, unicode, etc. are
     *   allowed (URL / path keys work out of the box).
     * - 'strict': allow only `[A-Za-z0-9-_:.]` (pre-1.9.2 behavior).
     * - 'off': no character validation (only empty + length).
     * @default 'safe'
     */
    validation?: 'safe' | 'strict' | 'off';
    /**
     * Custom allowlist pattern; the key must match it (overrides `validation`'s
     * character check). Empty/whitespace/control/length rules still apply.
     */
    pattern?: RegExp;
  };

  /** Event-driven invalidation config */
  invalidation?: IInvalidationOptions;

  /**
   * Context provider for automatic key enrichment.
   * Allows integrating CLS, AsyncLocalStorage, or custom context management.
   *
   * @example nestjs-cls
   * ```typescript
   * import { ClsService } from 'nestjs-cls';
   *
   * contextProvider: {
   *   get: (key) => clsService.get(key),
   * }
   * ```
   *
   * @example AsyncLocalStorage
   * ```typescript
   * const als = new AsyncLocalStorage<Map<string, any>>();
   * contextProvider: {
   *   get: (key) => als.getStore()?.get(key),
   * }
   * ```
   */
  contextProvider?: import('./context-provider.interface').IContextProvider;

  /**
   * Keys to extract from context provider and append to cache keys.
   * These keys will be automatically added to all cache keys unless skipContext is set.
   *
   * @example ['tenantId', 'userId', 'locale']
   * @default []
   */
  contextKeys?: string[];
}

/**
 * Warmup key configuration.
 */
export interface IWarmupKey {
  key: string;
  loader: () => Promise<unknown>;
  ttl?: number;
  tags?: string[];
}

/**
 * Cache set options.
 */
export interface ICacheSetOptions {
  ttl?: number;
  tags?: string[];
  strategy?: 'l1-only' | 'l2-only' | 'l1-l2';
  varyBy?: Record<string, string>;
}

/**
 * Cache getOrSet options.
 */
export interface ICacheGetOrSetOptions extends ICacheSetOptions {
  swr?: {
    enabled?: boolean;
    staleTime?: number;
  };

  /** Per-call stale-if-error override (see plugin `staleIfError`). */
  staleIfError?: {
    enabled?: boolean;
    /** Seconds to retain and serve on loader errors beyond normal expiry. */
    window?: number;
    /** Whether this error qualifies for stale serving (default: any). */
    shouldServe?: (error: Error) => boolean;
  };
  skipStampede?: boolean;
  /** Skip caching if this function returns true for the loaded value. */
  unless?: (result: unknown) => boolean;
}

/**
 * Cache statistics.
 */
export interface ICacheStats {
  l1: {
    hits: number;
    misses: number;
    size: number;
  };
  l2: {
    hits: number;
    misses: number;
  };
  stampedePrevented: number;
}

/**
 * SWR entry result with metadata.
 */
export interface ISwrEntry<T> {
  /** The cached value */
  value: T;

  /** Timestamp when value was cached (ms) */
  cachedAt: number;

  /** Timestamp when value becomes stale (ms) */
  staleAt: number;

  /** Timestamp when value expires completely (ms) */
  expiresAt: number;

  /**
   * Timestamp until which the value is physically retained for
   * stale-if-error serving (ms). Present only when staleIfError is enabled;
   * between expiresAt and keepUntil the value is used ONLY when the loader
   * fails — on the success path this range behaves as a miss.
   */
  keepUntil?: number;
}

/**
 * Stampede execution result.
 */
export interface IStampedeResult<T> {
  value: T;
  cached: boolean;
  waited: boolean;
}

/**
 * Stampede statistics.
 */
export interface IStampedeStats {
  activeFlights: number;
  totalWaiters: number;
  oldestFlight: number;
  prevented: number;
}

/**
 * Stampede options.
 */
export interface IStampedeOptions {
  lockTimeout: number;
  waitTimeout: number;
}

/**
 * Scan result.
 */
export interface IScanResult {
  cursor: string;
  keys: string[];
}

/**
 * Event-driven invalidation options.
 */
export interface IInvalidationOptions {
  /**
   * Enable event-driven invalidation.
   * @default true
   */
  enabled?: boolean;

  /**
   * Event source type.
   * @default 'internal'
   */
  source?: 'internal' | 'amqp' | 'custom';

  /**
   * AMQP configuration (if source = 'amqp').
   */
  amqp?: {
    /**
     * Exchange to listen for invalidation events.
     * @default 'cache.invalidation'
     */
    exchange?: string;

    /**
     * Queue name for this service.
     * @default '{serviceName}.cache.invalidation'
     */
    queue?: string;

    /**
     * Routing key patterns to subscribe.
     * @default ['#'] (all events)
     */
    routingKeys?: string[];
  };

  /**
   * Static invalidation rules.
   * Can also be registered dynamically via InvalidationRegistry.
   */
  rules?: IInvalidationRuleProps[];

  /**
   * Default TTL for tracking processed events (dedup).
   * @default 60 (seconds)
   */
  deduplicationTtl?: number;
}

/**
 * Invalidation rule properties.
 */
export interface IInvalidationRuleProps {
  /**
   * Event pattern to match.
   * Supports wildcards: 'user.*', '*.updated', '#'
   */
  event: string;

  /**
   * Tags to invalidate.
   * Supports templates: 'user:{userId}', 'tenant:{payload.tenantId}'
   */
  tags?: string[];

  /**
   * Keys to invalidate directly.
   * Supports templates: 'user:{userId}:profile'
   */
  keys?: string[];

  /**
   * Condition for invalidation.
   */
  condition?: (payload: unknown) => boolean;

  /**
   * Priority (higher = processed first).
   * @default 0
   */
  priority?: number;
}

export type CacheSetOptions = ICacheSetOptions;
export type CacheGetOrSetOptions = ICacheGetOrSetOptions;
export type CacheStats = ICacheStats;
export type SwrEntry<T = unknown> = ISwrEntry<T>;
export type StampedeResult<T = unknown> = IStampedeResult<T>;
export type StampedeStats = IStampedeStats;
export type StampedeOptions = IStampedeOptions;
export type ScanResult = IScanResult;
