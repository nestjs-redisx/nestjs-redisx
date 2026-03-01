/**
 * Cache plugin for NestJS RedisX.
 * Provides L1+L2 caching with anti-stampede, SWR, and tag invalidation.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
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
import { CACHE_PLUGIN_OPTIONS, CACHE_REDIS_DRIVER, CACHE_SERVICE, DEFAULT_CACHE_CONFIG, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE, INVALIDATION_RULES_INIT, L1_CACHE_STORE, L2_CACHE_STORE, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, SERIALIZER, LUA_SCRIPT_LOADER } from './shared/constants';
import { ICachePluginOptions } from './shared/types';
import { StampedeProtectionService } from './stampede/infrastructure/stampede-protection.service';
import { SwrManagerService } from './swr/infrastructure/swr-manager.service';
import { TagIndexRepository } from './tags/infrastructure/repositories/tag-index.repository';
import { LuaScriptLoader } from './tags/infrastructure/services/lua-script-loader.service';

export class CachePlugin implements IRedisXPlugin {
  readonly name = 'cache';
  readonly version: string = version;
  readonly description = 'Advanced caching with L1+L2, anti-stampede, SWR, and tag invalidation';

  private asyncOptions?: IPluginAsyncOptions<ICachePluginOptions>;

  constructor(private readonly options: ICachePluginOptions = {}) {}

  /**
   * Create a CachePlugin with async configuration from DI.
   *
   * @example
   * ```typescript
   * CachePlugin.registerAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     l1: { maxSize: config.get('CACHE_L1_MAX_SIZE', 1000) },
   *     swr: { enabled: config.get('CACHE_SWR_ENABLED', false) },
   *   }),
   * })
   * ```
   */
  static registerAsync(asyncOptions: IPluginAsyncOptions<ICachePluginOptions>): CachePlugin {
    const plugin = new CachePlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ICachePluginOptions): ICachePluginOptions {
    return {
      client: options.client,
      l1: { ...DEFAULT_CACHE_CONFIG.l1, ...options.l1 },
      l2: { ...DEFAULT_CACHE_CONFIG.l2, ...options.l2 },
      stampede: { ...DEFAULT_CACHE_CONFIG.stampede, ...options.stampede },
      swr: { ...DEFAULT_CACHE_CONFIG.swr, ...options.swr },
      tags: { ...DEFAULT_CACHE_CONFIG.tags, ...options.tags },
      warmup: { ...DEFAULT_CACHE_CONFIG.warmup, ...options.warmup },
      keys: { ...DEFAULT_CACHE_CONFIG.keys, ...options.keys },
      invalidation: { ...DEFAULT_CACHE_CONFIG.invalidation, ...options.invalidation },
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    // Options provider: useFactory (async) or useValue (sync)
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: CACHE_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return CachePlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: CACHE_PLUGIN_OPTIONS,
          useValue: CachePlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: CACHE_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ICachePluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch (error) {
            throw new Error(`CachePlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, CACHE_PLUGIN_OPTIONS],
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
