/**
 * Cache plugin for NestJS RedisX.
 * Provides L1+L2 caching with anti-stampede, SWR, and tag invalidation.
 */

import { Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin } from '@nestjs-redisx/core';

import { CacheDecoratorInitializerService } from './cache/application/services/cache-decorator-initializer.service';
import { CacheService as InternalCacheService } from './cache/application/services/cache.service';
import { WarmupService } from './cache/application/services/warmup.service';
import { Serializer } from './cache/domain/services/serializer.service';
import { L1MemoryStoreAdapter } from './cache/infrastructure/adapters/l1-memory-store.adapter';
import { L2RedisStoreAdapter } from './cache/infrastructure/adapters/l2-redis-store.adapter';
import { CacheService } from './cache.service';
import { EventInvalidationService } from './invalidation/application/services/event-invalidation.service';
import { InvalidationRegistryService } from './invalidation/application/services/invalidation-registry.service';
import { InvalidationRule } from './invalidation/domain/entities/invalidation-rule.entity';
import { AMQPEventSourceAdapter } from './invalidation/infrastructure/adapters/amqp-event-source.adapter';
import { CACHE_PLUGIN_OPTIONS, CACHE_SERVICE, DEFAULT_CACHE_CONFIG, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE, INVALIDATION_RULES_INIT, L1_CACHE_STORE, L2_CACHE_STORE, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, SERIALIZER, LUA_SCRIPT_LOADER } from './shared/constants';
import { ICachePluginOptions } from './shared/types';
import { StampedeProtectionService } from './stampede/infrastructure/stampede-protection.service';
import { SwrManagerService } from './swr/infrastructure/swr-manager.service';
import { TagIndexRepository } from './tags/infrastructure/repositories/tag-index.repository';
import { LuaScriptLoader } from './tags/infrastructure/services/lua-script-loader.service';

export class CachePlugin implements IRedisXPlugin {
  readonly name = 'cache';
  readonly version = '0.1.0';
  readonly description = 'Advanced caching with L1+L2, anti-stampede, SWR, and tag invalidation';

  constructor(private readonly options: ICachePluginOptions = {}) {}

  getProviders(): Provider[] {
    // Merge user options with defaults
    const config: ICachePluginOptions = {
      l1: { ...DEFAULT_CACHE_CONFIG.l1, ...this.options.l1 },
      l2: { ...DEFAULT_CACHE_CONFIG.l2, ...this.options.l2 },
      stampede: { ...DEFAULT_CACHE_CONFIG.stampede, ...this.options.stampede },
      swr: { ...DEFAULT_CACHE_CONFIG.swr, ...this.options.swr },
      tags: { ...DEFAULT_CACHE_CONFIG.tags, ...this.options.tags },
      warmup: { ...DEFAULT_CACHE_CONFIG.warmup, ...this.options.warmup },
      keys: { ...DEFAULT_CACHE_CONFIG.keys, ...this.options.keys },
      invalidation: {
        ...DEFAULT_CACHE_CONFIG.invalidation,
        ...this.options.invalidation,
      },
    };

    return [
      // Configuration
      {
        provide: CACHE_PLUGIN_OPTIONS,
        useValue: config,
      },

      // Domain services
      {
        provide: SERIALIZER,
        useClass: Serializer,
      },

      // Infrastructure adapters
      {
        provide: L1_CACHE_STORE,
        useClass: L1MemoryStoreAdapter,
      },
      {
        provide: L2_CACHE_STORE,
        useClass: L2RedisStoreAdapter,
      },

      // Application services
      {
        provide: CACHE_SERVICE,
        useClass: InternalCacheService,
      },
      {
        provide: STAMPEDE_PROTECTION,
        useClass: StampedeProtectionService,
      },
      {
        provide: TAG_INDEX,
        useClass: TagIndexRepository,
      },
      {
        provide: SWR_MANAGER,
        useClass: SwrManagerService,
      },
      {
        provide: LUA_SCRIPT_LOADER,
        useClass: LuaScriptLoader,
      },

      // Invalidation services
      {
        provide: INVALIDATION_REGISTRY,
        useClass: InvalidationRegistryService,
      },
      {
        provide: EVENT_INVALIDATION_SERVICE,
        useClass: EventInvalidationService,
      },

      // Invalidation adapters (optional)
      AMQPEventSourceAdapter,

      // Public API
      CacheService,

      // @Cached decorator initialization
      CacheDecoratorInitializerService,

      // Cache warmup (runs on OnModuleInit if enabled)
      WarmupService,

      // Reflector is needed for decorator metadata
      Reflector,

      // Factory for registering static invalidation rules
      {
        provide: INVALIDATION_RULES_INIT,
        useFactory: (registry: InvalidationRegistryService, config: ICachePluginOptions) => {
          // Register static rules from config
          if (config.invalidation?.rules && config.invalidation.rules.length > 0) {
            const rules = config.invalidation.rules.map((ruleProps) => InvalidationRule.create(ruleProps));
            registry.registerMany(rules);
          }
          return true;
        },
        inject: [INVALIDATION_REGISTRY, CACHE_PLUGIN_OPTIONS],
      },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [CACHE_PLUGIN_OPTIONS, CACHE_SERVICE, CacheService, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE];
  }
}
