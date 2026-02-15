/**
 * Shared constants for Cache plugin.
 */

/**
 * Injection tokens.
 */
export const CACHE_PLUGIN_OPTIONS = Symbol.for('CACHE_PLUGIN_OPTIONS');
export const CACHE_SERVICE = Symbol.for('CACHE_SERVICE');
export const L1_CACHE_STORE = Symbol.for('L1_CACHE_STORE');
export const L2_CACHE_STORE = Symbol.for('L2_CACHE_STORE');
export const STAMPEDE_PROTECTION = Symbol.for('STAMPEDE_PROTECTION');
export const TAG_INDEX = Symbol.for('TAG_INDEX');
export const SWR_MANAGER = Symbol.for('SWR_MANAGER');
export const TAG_CONFIG = Symbol.for('TAG_CONFIG');
export const SERIALIZER = Symbol.for('SERIALIZER');
export const INVALIDATION_REGISTRY = Symbol.for('INVALIDATION_REGISTRY');
export const EVENT_INVALIDATION_SERVICE = Symbol.for('EVENT_INVALIDATION_SERVICE');
export const LUA_SCRIPT_LOADER = Symbol.for('LUA_SCRIPT_LOADER');
export const INVALIDATION_RULES_INIT = Symbol.for('INVALIDATION_RULES_INIT');
export const AMQP_CONNECTION = Symbol.for('AMQP_CONNECTION');

/**
 * Metadata keys for decorators.
 */
export const CACHE_OPTIONS_KEY = 'cache:options';
export const INVALIDATE_TAGS_KEY = 'cache:invalidate:tags';

/**
 * Default configuration values.
 */
export const DEFAULT_CACHE_CONFIG = {
  l1: {
    enabled: true,
    maxSize: 1000,
    ttl: 60,
    evictionPolicy: 'lru' as const,
  },
  l2: {
    enabled: true,
    defaultTtl: 3600,
    maxTtl: 86400,
    keyPrefix: 'cache:',
    clientName: 'default',
  },
  stampede: {
    enabled: true,
    lockTimeout: 5000,
    waitTimeout: 10000,
    fallback: 'load' as const,
  },
  swr: {
    enabled: false,
    defaultStaleTime: 60,
  },
  tags: {
    enabled: true,
    indexPrefix: '_tag:',
    maxTagsPerKey: 10,
  },
  warmup: {
    enabled: false,
    concurrency: 10,
  },
  keys: {
    maxLength: 1024,
    version: 'v1',
    separator: ':',
  },
  invalidation: {
    enabled: true,
    source: 'internal' as const,
    deduplicationTtl: 60,
  },
} as const;
