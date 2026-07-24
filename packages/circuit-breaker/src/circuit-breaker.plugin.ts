/**
 * Circuit breaker plugin for NestJS RedisX.
 * Provides a distributed circuit breaker (closed / open / half-open) backed by
 * Redis, with a pure, time-injected state-machine core.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { CircuitBreakerDecoratorInitializerService } from './circuit-breaker/application/services/circuit-breaker-decorator-initializer.service';
import { CircuitBreakerService } from './circuit-breaker/application/services/circuit-breaker.service';
import { validateCircuitBreakerConfig } from './circuit-breaker/domain/validate-circuit-breaker-config';
import { RedisCircuitBreakerStoreAdapter } from './circuit-breaker/infrastructure/adapters/redis-circuit-breaker-store.adapter';
import { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_REDIS_DRIVER, CIRCUIT_BREAKER_SERVICE, CIRCUIT_BREAKER_STORE, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './shared/constants';
import { ICircuitBreakerPluginOptions } from './shared/types';

/**
 * Circuit breaker plugin for NestJS RedisX.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new CircuitBreakerPlugin({
 *           failureThreshold: 5,
 *           windowMs: 10000,
 *           openDurationMs: 30000,
 *           halfOpenMaxCalls: 1,
 *           successThreshold: 1,
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class CircuitBreakerPlugin implements IRedisXPlugin {
  readonly name = 'circuit-breaker';
  readonly version: string = version;
  readonly description = 'Distributed circuit breaker (closed/open/half-open) with a pure, time-injected state machine';

  private asyncOptions?: IPluginAsyncOptions<ICircuitBreakerPluginOptions>;

  constructor(private readonly options: ICircuitBreakerPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ICircuitBreakerPluginOptions>): CircuitBreakerPlugin {
    const plugin = new CircuitBreakerPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ICircuitBreakerPluginOptions): ICircuitBreakerPluginOptions {
    const openDurationMs = options.openDurationMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.openDurationMs;
    const merged: ICircuitBreakerPluginOptions = {
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.keyPrefix,
      failureThreshold: options.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      windowMs: options.windowMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.windowMs,
      openDurationMs,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenMaxCalls,
      successThreshold: options.successThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold,
      // Dynamic default: a probe hanging longer than the cooldown is presumed dead.
      probeTimeoutMs: options.probeTimeoutMs ?? openDurationMs,
      errorPolicy: options.errorPolicy ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.errorPolicy,
      errorFactory: options.errorFactory,
    };

    // Fail fast at bootstrap: an invalid config must never reach the Lua scripts.
    validateCircuitBreakerConfig({
      failureThreshold: merged.failureThreshold!,
      windowMs: merged.windowMs!,
      openDurationMs: merged.openDurationMs!,
      halfOpenMaxCalls: merged.halfOpenMaxCalls!,
      successThreshold: merged.successThreshold!,
      probeTimeoutMs: merged.probeTimeoutMs!,
    });

    return merged;
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: CIRCUIT_BREAKER_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return CircuitBreakerPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: CIRCUIT_BREAKER_PLUGIN_OPTIONS,
          useValue: CircuitBreakerPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: CIRCUIT_BREAKER_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ICircuitBreakerPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`CircuitBreakerPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, CIRCUIT_BREAKER_PLUGIN_OPTIONS],
      },

      // Store adapter
      {
        provide: CIRCUIT_BREAKER_STORE,
        useClass: RedisCircuitBreakerStoreAdapter,
      },

      // Application service
      {
        provide: CIRCUIT_BREAKER_SERVICE,
        useClass: CircuitBreakerService,
      },

      // @WithCircuitBreaker decorator initialization (proxy-based)
      CircuitBreakerDecoratorInitializerService,

      // Reflector is needed for decorator metadata
      Reflector,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [CIRCUIT_BREAKER_SERVICE];
  }
}
