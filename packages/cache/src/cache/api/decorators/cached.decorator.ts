/**
 * @Cached decorator for method-level caching.
 *
 * Uses immediate proxy-based wrapping (not deferred to module init).
 * Works on ANY Injectable class methods (services, repositories, etc).
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { CACHE_OPTIONS_KEY } from '../../../shared/constants';

const logger = new Logger('Cached');

/**
 * Cache service interface for decorator use.
 * Minimal subset of ICacheService needed by decorators.
 */
interface IDecoratorCacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(
    key: string,
    value: T,
    options?: {
      ttl?: number;
      tags?: string[];
      strategy?: 'l1-only' | 'l2-only' | 'l1-l2';
    },
  ): Promise<void>;
  getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options?: {
      ttl?: number;
      tags?: string[];
      strategy?: 'l1-only' | 'l2-only' | 'l1-l2';
      swr?: { enabled?: boolean; staleTime?: number };
      unless?: (result: unknown) => boolean;
    },
  ): Promise<T>;
  invalidateTags(tags: string[]): Promise<number>;
  deleteMany(keys: string[]): Promise<number>;
}

/**
 * Context provider interface for decorator use.
 */
interface IDecoratorContextProvider {
  get<T = unknown>(key: string): T | undefined;
}

/**
 * Plugin options subset needed by decorators for context enrichment.
 */
interface IDecoratorPluginOptions {
  contextProvider?: IDecoratorContextProvider;
  contextKeys?: string[];
  keys?: {
    separator?: string;
  };
}

// Global service registry for lazy injection
let globalCacheServiceGetter: (() => IDecoratorCacheService) | null = null;
let globalPluginOptions: IDecoratorPluginOptions | null = null;

/**
 * Register cache service getter for lazy injection.
 * Called by CacheDecoratorInitializerService during initialization.
 */
export function registerCacheServiceGetter(getter: () => IDecoratorCacheService): void {
  globalCacheServiceGetter = getter;
}

/**
 * Register plugin options for context enrichment in decorators.
 * Called by CacheDecoratorInitializerService during initialization.
 */
export function registerCachePluginOptions(options: IDecoratorPluginOptions): void {
  globalPluginOptions = options;
}

/**
 * Get the registered cache service.
 * Used by other cache decorators (@InvalidateTags, etc.)
 */
export function getCacheService(): IDecoratorCacheService | null {
  return globalCacheServiceGetter ? globalCacheServiceGetter() : null;
}

export interface ICachedOptions {
  /**
   * Cache key template. Use {0}, {1}, etc. for method arguments.
   * Example: 'user:{0}' for first argument.
   *
   * If omitted, key is auto-generated as `ClassName:methodName:args`.
   */
  key?: string;

  /**
   * TTL in seconds. Defaults to plugin's defaultTtl.
   */
  ttl?: number;

  /**
   * Tags for invalidation. Can be static array or function of args.
   */
  tags?: string[] | ((...args: unknown[]) => string[]);

  /**
   * Cache strategy: where to store the cached value.
   * - 'l1-only': Only in-memory cache
   * - 'l2-only': Only Redis cache
   * - 'l1-l2': Both layers (default)
   */
  strategy?: 'l1-only' | 'l2-only' | 'l1-l2';

  /**
   * Condition to check BEFORE method execution.
   * If returns false, skip caching and execute method.
   */
  condition?: (...args: unknown[]) => boolean;

  /**
   * Condition to check AFTER method execution.
   * If returns true, don't cache the result.
   */
  unless?: (result: unknown, ...args: unknown[]) => boolean;

  /**
   * Additional context keys to vary cache by.
   * Values are resolved from contextProvider at call time.
   * Adds to (not replaces) global contextKeys.
   *
   * Works on any Injectable — values come from contextProvider (CLS, AsyncLocalStorage, etc.),
   * not from HTTP headers. Ignored if contextProvider is not configured.
   *
   * @example
   * ```typescript
   * @Cached({
   *   key: 'products',
   *   varyBy: ['locale', 'currency']  // resolved from contextProvider
   * })
   * ```
   */
  varyBy?: string[];

  /**
   * Stale-while-revalidate configuration.
   * If enabled, serves stale data while revalidating in background.
   */
  swr?: {
    enabled?: boolean;
    staleTime?: number;
  };

  /**
   * Context keys to include in cache key (from contextProvider).
   * Overrides global contextKeys for this method.
   */
  contextKeys?: string[];

  /**
   * Disable context enrichment for this method.
   * Set to true to prevent automatic context keys from being added.
   *
   * @default false
   */
  skipContext?: boolean;
}

/**
 * Caches method return value using immediate proxy-based wrapping.
 *
 * Works on any Injectable class method, not just controllers.
 * Wrapping happens immediately when decorator is applied.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @Cached({ key: 'user:{0}', ttl: 3600, tags: ['users'] })
 *   async getUser(id: string): Promise<User> {
 *     return this.userRepository.findById(id);
 *   }
 * }
 * ```
 */
export function Cached(options: ICachedOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    // Replace method with caching proxy
    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      // Lazy inject cache service on first call
      if (!globalCacheServiceGetter) {
        logger.warn(`@Cached: CacheService not yet available, executing method without cache`);
        return originalMethod.apply(this, args);
      }

      const cacheService = globalCacheServiceGetter();
      if (!cacheService) {
        logger.warn(`@Cached: CacheService getter returned null, executing method without cache`);
        return originalMethod.apply(this, args);
      }

      // Check condition (before execution) — if false, bypass cache entirely
      if (options.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      // Build cache key with context enrichment
      const key = buildCacheKey(this, propertyKey.toString(), args, options);

      // Resolve tags (static array or function of args)
      const tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;

      // Delegate to getOrSet — stampede protection is handled internally
      try {
        return await cacheService.getOrSet(key, () => originalMethod.apply(this, args), {
          ttl: options.ttl,
          tags,
          strategy: options.strategy,
          swr: options.swr,
          unless: options.unless ? (result: unknown) => options.unless!(result, ...args) : undefined,
        });
      } catch (error) {
        logger.error(`@Cached: getOrSet error for key ${key}:`, error);
        // Fail-open: execute method without cache
        return originalMethod.apply(this, args);
      }
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Store metadata on WRAPPER function for reflection (after replacement)
    Reflect.defineMetadata(CACHE_OPTIONS_KEY, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Builds cache key from template and arguments, then enriches with context.
 *
 * Key pipeline:
 * 1. Base key: from template ({0}, {1}) or auto-generated (Class:method:args)
 * 2. Context enrichment: contextKeys + varyBy resolved from contextProvider
 *    Format: `baseKey:_ctx_:key1.val1:key2.val2`
 */
function buildCacheKey(instance: object, methodName: string, args: unknown[], options: ICachedOptions): string {
  const className = (instance.constructor as { name: string }).name;

  // Step 1: Build base key
  let baseKey: string;
  if (options.key) {
    baseKey = interpolateKey(options.key, args);
  } else {
    const argKeys = args.map((arg) => serializeArg(arg)).join(':');
    baseKey = `${className}:${methodName}:${argKeys}`;
  }

  // Step 2: Enrich with context (contextKeys + varyBy)
  return enrichWithContext(baseKey, options);
}

/**
 * Enriches a base key with context values from contextProvider.
 * Uses the same _ctx_ marker format as the internal cache service
 * so enrichKeyWithContext() won't double-enrich.
 */
function enrichWithContext(key: string, options: ICachedOptions): string {
  // Skip if explicitly disabled
  if (options.skipContext) return key;

  const pluginOpts = globalPluginOptions;
  if (!pluginOpts?.contextProvider) return key;

  const separator = pluginOpts.keys?.separator ?? ':';
  const marker = `${separator}_ctx_${separator}`;

  const contextMap = new Map<string, string>();

  // Determine which context keys to use:
  // - Per-decorator contextKeys override global ones
  // - varyBy adds additional keys on top
  const contextKeys = options.contextKeys ?? pluginOpts.contextKeys ?? [];

  // Resolve context keys from provider
  for (const ctxKey of contextKeys) {
    const value = pluginOpts.contextProvider.get<string>(ctxKey);
    if (value !== undefined && value !== null) {
      contextMap.set(ctxKey, String(value));
    }
  }

  // Resolve varyBy keys from provider (additional to contextKeys)
  if (options.varyBy) {
    for (const name of options.varyBy) {
      if (!contextMap.has(name)) {
        const value = pluginOpts.contextProvider.get<string>(name);
        if (value !== undefined && value !== null) {
          contextMap.set(name, String(value));
        }
      }
    }
  }

  if (contextMap.size === 0) return key;

  // Sort for consistent key ordering
  const sortedEntries = [...contextMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const suffix = sortedEntries.map(([k, v]) => `${sanitizeForKey(k)}.${sanitizeForKey(v)}`).join(separator);

  return `${key}${marker}${suffix}`;
}

/**
 * Sanitizes a value for use in cache key (removes non-allowed characters).
 */
function sanitizeForKey(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9\-_]/g, '_');
}

/**
 * Interpolates key template with arguments.
 */
function interpolateKey(template: string, args: unknown[]): string {
  return template.replace(/\{(\d+)}/g, (match, index: string) => {
    const argIndex = parseInt(index, 10);
    if (argIndex < args.length) {
      return serializeArg(args[argIndex]);
    }
    return match;
  });
}

/**
 * Serializes argument to string for cache key.
 * Objects are serialized with sorted keys for deterministic output.
 */
function serializeArg(arg: unknown): string {
  if (arg === null || arg === undefined) {
    return 'null';
  }

  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
    return String(arg);
  }

  if (typeof arg === 'object') {
    try {
      return stableStringify(arg);
    } catch {
      return 'object';
    }
  }

  return 'unknown';
}

/**
 * Produces a deterministic JSON string by sorting object keys recursively.
 * Ensures {b:2, a:1} and {a:1, b:2} produce the same cache key.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  // Functions and symbols are not serializable (matches JSON.stringify behavior)
  if (typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }

  if (typeof value !== 'object') {
    // BigInt throws in JSON.stringify; convert to string for safe key generation
    if (typeof value === 'bigint') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  // Arrays: preserve order, serialize undefined/functions as null (matches JSON.stringify)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined || typeof item === 'function' || typeof item === 'symbol' ? 'null' : stableStringify(item))).join(',') + ']';
  }

  if (value instanceof Date) {
    return JSON.stringify(value);
  }

  // Plain objects: sort keys, skip undefined/function/symbol values (matches JSON.stringify)
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
      continue; // JSON.stringify skips these in objects
    }
    parts.push(JSON.stringify(key) + ':' + stableStringify(v));
  }
  return '{' + parts.join(',') + '}';
}
