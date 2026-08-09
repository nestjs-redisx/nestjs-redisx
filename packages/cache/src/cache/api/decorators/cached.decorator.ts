/**
 * @Cached decorator for method-level caching.
 *
 * Uses immediate proxy-based wrapping (not deferred to module init).
 * Works on ANY Injectable class methods (services, repositories, etc).
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { CACHE_OPTIONS_KEY } from '../../../shared/constants';
import { LoaderError } from '../../../shared/errors';
import { hashKey } from '../../../shared/utils/stable-hash';

const logger = new Logger('Cached');

/** Marks an error as thrown by the wrapped method (not the cache layer). */
const LOADER_ERROR = Symbol('redisx.cached.loaderError');

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
      staleIfError?: { enabled?: boolean; window?: number; shouldServe?: (error: Error) => boolean };
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
   * Stale-if-error configuration (per-method override, see plugin
   * `staleIfError`): serve the last known value when the loader fails,
   * for `window` seconds beyond the normal expiry.
   */
  staleIfError?: {
    enabled?: boolean;
    /** Seconds to retain and serve on loader errors beyond normal expiry. */
    window?: number;
    /** Whether this error qualifies for stale serving (default: any). */
    shouldServe?: (error: Error) => boolean;
  };

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

      // Resolve tags (static array or function of args); interpolate {n}
      // templates in static tags the same way as the key.
      const tags = resolveTags(options.tags, args);

      // Tag errors thrown by the wrapped method so they can be told apart from
      // genuine cache-infrastructure failures below.
      const loader = async (): Promise<unknown> => {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          if (error && typeof error === 'object') {
            (error as Record<symbol, unknown>)[LOADER_ERROR] = true;
          }
          throw error;
        }
      };

      // Delegate to getOrSet — stampede protection is handled internally
      try {
        return await cacheService.getOrSet(key, loader, {
          ttl: options.ttl,
          tags,
          strategy: options.strategy,
          swr: options.swr,
          staleIfError: options.staleIfError,
          unless: options.unless ? (result: unknown) => options.unless!(result, ...args) : undefined,
        });
      } catch (error) {
        // The wrapped method itself threw (e.g. a NotFoundException). It is NOT
        // a cache failure: propagate the ORIGINAL error as-is, without
        // re-running the method (no double DB hit) and without logging it as a
        // cache error. With stampede protection the loader error arrives
        // wrapped as LoaderError (unwrap its cause so the caller sees its own
        // exception, e.g. -> 404); without stampede it arrives raw but tagged.
        if (error instanceof LoaderError) {
          throw error.cause ?? error;
        }
        if (error && typeof error === 'object' && (error as Record<symbol, unknown>)[LOADER_ERROR]) {
          throw error;
        }
        // Genuine cache-infrastructure error → fail-open: run the method once.
        logger.error(`@Cached: cache error for key ${key}, executing method without cache:`, error);
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
      if (typeof value === 'object') {
        logger.warn(`Context key "${ctxKey}" has object value, skipping (use primitives for context keys)`);
        continue;
      }
      contextMap.set(ctxKey, String(value));
    }
  }

  // Resolve varyBy keys from provider (additional to contextKeys)
  if (options.varyBy) {
    for (const name of options.varyBy) {
      if (!contextMap.has(name)) {
        const value = pluginOpts.contextProvider.get<string>(name);
        if (value !== undefined && value !== null) {
          if (typeof value === 'object') {
            logger.warn(`varyBy key "${name}" has object value, skipping (use primitives for varyBy keys)`);
            continue;
          }
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
 * Resolves a `tags` option to concrete tag strings.
 *
 * A function receives the call arguments. A static array supports the SAME
 * `{n}` template placeholders as `key` — so `tags: ['user:{0}']` becomes
 * `['user:42']` instead of the literal `user:{0}` (which would never match on
 * invalidation). Shared by `@Cached` and `@InvalidateTags` so the tag written
 * on read and the tag invalidated on write are produced identically.
 */
export function resolveTags(tags: string[] | ((...args: unknown[]) => string[]) | undefined, args: unknown[]): string[] | undefined {
  if (tags === undefined) {
    return undefined;
  }
  if (typeof tags === 'function') {
    return tags(...args);
  }
  return interpolateTags(tags, args);
}

/**
 * Interpolates `{n}` positional placeholders in each static tag with the
 * method arguments — the single source of truth shared by every proxy-based
 * decorator (`@Cached`, `@InvalidateTags`, `@InvalidateOn`) so the tag written
 * on read and the tag invalidated on write are produced IDENTICALLY. Tags
 * without a `{` are returned untouched.
 */
export function interpolateTags(tags: string[], args: unknown[]): string[] {
  return tags.map((tag) => (tag.includes('{') ? interpolateKey(tag, args) : tag));
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
 * Primitives are used as-is. Objects are deterministically stringified
 * and then hashed (SHA-256, first 16 hex chars) to produce short,
 * CacheKey-valid strings without special characters.
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
      // Same frozen algorithm as the public hashKey() — moving it must never
      // change the generated cache keys (guarded by a golden-vector test).
      return hashKey(arg);
    } catch {
      return 'object';
    }
  }

  return 'unknown';
}
