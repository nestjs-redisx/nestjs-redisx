// Plugin
export { CachePlugin } from './cache.plugin';

// Services
export { CacheService } from './cache.service';
export { InvalidationRegistryService } from './invalidation/application/services/invalidation-registry.service';
export { EventInvalidationService } from './invalidation/application/services/event-invalidation.service';

// Ports (Interfaces)
export type { ICacheService } from './cache/application/ports/cache-service.port';
export type { IL1CacheStore } from './cache/application/ports/l1-cache-store.port';
export type { IL2CacheStore } from './cache/application/ports/l2-cache-store.port';
export type { IStampedeProtection } from './stampede/application/ports/stampede-protection.port';
export type { ITagIndex } from './tags/application/ports/tag-index.port';
export type { ISwrManager } from './swr/application/ports/swr-manager.port';
export type { IInvalidationRegistry, IResolvedInvalidation } from './invalidation/application/ports/invalidation-registry.port';
export type { IEventInvalidationService, IInvalidationResult, InvalidationHandler } from './invalidation/application/ports/event-invalidation.port';

// Value Objects
export { CacheKey } from './cache/domain/value-objects/cache-key.vo';
export { CacheEntry } from './cache/domain/value-objects/cache-entry.vo';
export { TTL } from './cache/domain/value-objects/ttl.vo';
export { EventPattern } from './invalidation/domain/value-objects/event-pattern.vo';
export { TagTemplate } from './invalidation/domain/value-objects/tag-template.vo';

// Entities
export { InvalidationRule } from './invalidation/domain/entities/invalidation-rule.entity';

// Decorators
export { Cached, type ICachedOptions } from './cache/api/decorators/cached.decorator';
export { InvalidateTags, type IInvalidateTagsOptions } from './cache/api/decorators/invalidate-tags.decorator';
export { InvalidateOn, type IInvalidateOnOptions } from './invalidation/infrastructure/decorators/invalidate-on.decorator';
export { Cacheable, type ICacheableOptions } from './decorators/cacheable.decorator';
export { CachePut, type ICachePutOptions } from './decorators/cache-put.decorator';
export { CacheEvict, type ICacheEvictOptions } from './decorators/cache-evict.decorator';

// Key generator utilities
export { generateKey, generateKeys, getParameterNames, getNestedValue, evaluateTags, evaluateCondition } from './decorators/key-generator.util';

// Interceptors
/**
 * Interceptor for Spring-style @Cacheable, @CachePut, @CacheEvict decorators.
 * Note: For new code, prefer using @Cached decorator (works on any Injectable).
 */
export { CacheInterceptor as DeclarativeCacheInterceptor } from './decorators/cache.interceptor';

// Types
export type { ICachePluginOptions, IContextProvider, IWarmupKey, CacheSetOptions, CacheGetOrSetOptions, CacheStats, SwrEntry, StampedeResult, StampedeOptions, ScanResult, IInvalidationOptions, IInvalidationRuleProps } from './shared/types';

// Errors
export { CacheError, CacheKeyError, SerializationError, LoaderError, StampedeError, TagInvalidationError } from './shared/errors';

// Constants
export { CACHE_PLUGIN_OPTIONS, CACHE_SERVICE, L1_CACHE_STORE, L2_CACHE_STORE, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, SERIALIZER, LUA_SCRIPT_LOADER, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE, AMQP_CONNECTION, CACHE_OPTIONS_KEY, INVALIDATE_TAGS_KEY, DEFAULT_CACHE_CONFIG } from './shared/constants';

// Strategies
export type { IEvictionStrategy } from './strategies';
export { LruStrategy, FifoStrategy, LfuStrategy } from './strategies';

// Serializers
export type { ISerializer } from './serializers';
export { JsonSerializer, MsgpackSerializer } from './serializers';

// Utilities
export { KeyBuilder, type IKeyBuilderOptions } from './key-builder';
