/**
 * Cache plugin for NestJS RedisX.
 * Provides L1+L2 caching with anti-stampede, SWR, and tag invalidation.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, REDIS_DRIVER, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { CacheDecoratorInitializerService } from './cache/application/services/cache-decorator-initializer.service';
import { CacheService as InternalCacheService } from './cache/application/services/cache.service';
import { WarmupService } from './cache/application/services/warmup.service';
import { Serializer } from './cache/domain/services/serializer.service';
import { InMemoryL2StoreAdapter } from './cache/infrastructure/adapters/in-memory-l2-store.adapter';
import { L1MemoryStoreAdapter } from './cache/infrastructure/adapters/l1-memory-store.adapter';
import { L2RedisStoreAdapter } from './cache/infrastructure/adapters/l2-redis-store.adapter';
import { createNullRedisDriver } from './cache/infrastructure/adapters/null-redis-driver';
import { CacheService } from './cache.service';
import { EventInvalidationService } from './invalidation/application/services/event-invalidation.service';
import { InvalidationRegistryService } from './invalidation/application/services/invalidation-registry.service';
import { InvalidationRule } from './invalidation/domain/entities/invalidation-rule.entity';
import { AMQPEventSourceAdapter } from './invalidation/infrastructure/adapters/amqp-event-source.adapter';
import { CACHE_PLUGIN_OPTIONS, CACHE_REDIS_DRIVER, CACHE_SERVICE, DEFAULT_CACHE_CONFIG, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE, INVALIDATION_RULES_INIT, L1_CACHE_STORE, L2_CACHE_STORE, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, SERIALIZER, LUA_SCRIPT_LOADER } from './shared/constants';
import { CacheConfigError } from './shared/errors';
import { CacheMode, ICachePluginOptions } from './shared/types';
import { StampedeProtectionService } from './stampede/infrastructure/stampede-protection.service';
import { SwrManagerService } from './swr/infrastructure/swr-manager.service';
import { validateCacheMode } from './shared/utils/validate-cache-mode';
import { validateStaleIfError } from './shared/utils/validate-stale-if-error';
import { InMemoryTagIndexRepository } from './tags/infrastructure/repositories/in-memory-tag-index.repository';
import { TagIndexRepository } from './tags/infrastructure/repositories/tag-index.repository';
import { LuaScriptLoader } from './tags/infrastructure/services/lua-script-loader.service';

export class CachePlugin implements IRedisXPlugin {
  readonly name = 'cache';
  readonly version: string = version;
  readonly description = 'Advanced caching with L1+L2, anti-stampede, SWR, and tag invalidation';

  private asyncOptions?: IPluginAsyncOptions<ICachePluginOptions> & { mode?: CacheMode };

  constructor(private readonly options: ICachePluginOptions = {}) {}

  /**
   * Create a CachePlugin with async configuration from DI.
   *
   * `mode` is a deployment-structural choice, so — like the plugin list itself —
   * it is set here on the async options, NOT returned by `useFactory`.
   *
   * @example
   * ```typescript
   * CachePlugin.registerAsync({
   *   mode: 'l1-only', // optional; set here, not in useFactory
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     l1: { maxSize: config.get('CACHE_L1_MAX_SIZE', 1000) },
   *     swr: { enabled: config.get('CACHE_SWR_ENABLED', false) },
   *   }),
   * })
   * ```
   */
  static registerAsync(asyncOptions: IPluginAsyncOptions<ICachePluginOptions> & { mode?: CacheMode }): CachePlugin {
    const plugin = new CachePlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  /** Resolves the deployment topology (construction-time, never from useFactory). */
  private resolveMode(): CacheMode {
    return this.options.mode ?? this.asyncOptions?.mode ?? 'l1-l2';
  }

  private static mergeDefaults(options: ICachePluginOptions): ICachePluginOptions {
    validateCacheMode(options);
    return {
      client: options.client,
      mode: options.mode ?? DEFAULT_CACHE_CONFIG.mode,
      l1: { ...DEFAULT_CACHE_CONFIG.l1, ...options.l1 },
      l2: { ...DEFAULT_CACHE_CONFIG.l2, ...options.l2 },
      stampede: { ...DEFAULT_CACHE_CONFIG.stampede, ...options.stampede },
      swr: { ...DEFAULT_CACHE_CONFIG.swr, ...options.swr },
      staleIfError: validateStaleIfError({ ...DEFAULT_CACHE_CONFIG.staleIfError, ...options.staleIfError }),
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
    // Deployment topology is decided at construction time (see resolveMode),
    // so the provider wiring can branch on it before any DI/factory runs.
    const l1Only = this.resolveMode() === 'l1-only';

    // Options provider: useFactory (async) or useValue (sync)
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: CACHE_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            const mode = this.resolveMode();
            // `mode` is structural — it must match the construction-time value,
            // never be introduced by the factory (the wiring already committed).
            if (userOptions.mode !== undefined && userOptions.mode !== mode) {
              throw new CacheConfigError(`set "mode" on the registerAsync options (next to useFactory), not in the factory result — factory returned "${userOptions.mode}" but the options say "${mode}".`);
            }
            return CachePlugin.mergeDefaults({ ...userOptions, mode });
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: CACHE_PLUGIN_OPTIONS,
          useValue: CachePlugin.mergeDefaults(this.options),
        };

    // In l1-only there is NO Redis: a null driver satisfies the plugin's own
    // injections without ever connecting. The same null driver also OVERRIDES
    // the core `REDIS_DRIVER` alias (plugin providers win on token collision),
    // so RedisModule's default-client provider no longer eagerly connects at
    // startup — this is what lets the app boot with no reachable Redis.
    // Otherwise the driver resolves the named client from the manager.
    const driverProviders: Provider[] = l1Only
      ? (() => {
          const nullDriver = createNullRedisDriver();
          return [
            { provide: CACHE_REDIS_DRIVER, useValue: nullDriver },
            { provide: REDIS_DRIVER, useValue: nullDriver },
          ];
        })()
      : [
          {
            provide: CACHE_REDIS_DRIVER,
            useFactory: async (manager: RedisClientManager, _init: void, options: ICachePluginOptions) => {
              const clientName = options.client ?? 'default';
              try {
                return await manager.getClient(clientName);
              } catch {
                throw new Error(`CachePlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
              }
            },
            inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, CACHE_PLUGIN_OPTIONS],
          },
        ];

    return [
      optionsProvider,

      // Plugin-specific Redis driver (null object + REDIS_DRIVER override in l1-only)
      ...driverProviders,

      // Domain services
      {
        provide: SERIALIZER,
        useClass: Serializer,
      },

      // Infrastructure adapters. In l1-only the L2 tier and tag index are
      // served from in-memory implementations (no Redis); L1 is unchanged.
      {
        provide: L1_CACHE_STORE,
        useClass: L1MemoryStoreAdapter,
      },
      {
        provide: L2_CACHE_STORE,
        useClass: l1Only ? InMemoryL2StoreAdapter : L2RedisStoreAdapter,
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
        useClass: l1Only ? InMemoryTagIndexRepository : TagIndexRepository,
      },
      {
        provide: SWR_MANAGER,
        useClass: SwrManagerService,
      },

      // Lua script loader is Redis-only; not wired in l1-only.
      ...(l1Only
        ? []
        : [
            {
              provide: LUA_SCRIPT_LOADER,
              useClass: LuaScriptLoader,
            },
          ]),

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
