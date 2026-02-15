/**
 * Idempotency plugin for NestJS RedisX.
 * Provides request deduplication with response replay for idempotent operations.
 */

import { Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin } from '@nestjs-redisx/core';

import { IdempotencyInterceptor } from './idempotency/api/interceptors/idempotency.interceptor';
import { IdempotencyService } from './idempotency/application/services/idempotency.service';
import { RedisIdempotencyStoreAdapter } from './idempotency/infrastructure/adapters/redis-idempotency-store.adapter';
import { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_SERVICE, IDEMPOTENCY_STORE } from './shared/constants';
import { IIdempotencyPluginOptions } from './shared/types';

const DEFAULT_IDEMPOTENCY_CONFIG: Required<Omit<IIdempotencyPluginOptions, 'isGlobal' | 'fingerprintGenerator'>> = {
  defaultTtl: 86400,
  keyPrefix: 'idempotency:',
  headerName: 'Idempotency-Key',
  lockTimeout: 30000,
  waitTimeout: 60000,
  validateFingerprint: true,
  fingerprintFields: ['method', 'path', 'body'],
  errorPolicy: 'fail-closed',
};

/**
 * Idempotency plugin for NestJS RedisX.
 *
 * Provides request deduplication with response replay:
 * - Prevents duplicate processing of same request
 * - Replays successful responses
 * - Handles concurrent requests
 * - Validates request fingerprints
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new IdempotencyPlugin({
 *           defaultTtl: 86400,
 *           headerName: 'Idempotency-Key',
 *           validateFingerprint: true,
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class IdempotencyPlugin implements IRedisXPlugin {
  readonly name = 'idempotency';
  readonly version = '0.1.0';
  readonly description = 'Request deduplication with response replay for idempotent operations';

  constructor(private readonly options: IIdempotencyPluginOptions = {}) {}

  getProviders(): Provider[] {
    const config: IIdempotencyPluginOptions = {
      defaultTtl: this.options.defaultTtl ?? DEFAULT_IDEMPOTENCY_CONFIG.defaultTtl,
      keyPrefix: this.options.keyPrefix ?? DEFAULT_IDEMPOTENCY_CONFIG.keyPrefix,
      headerName: this.options.headerName ?? DEFAULT_IDEMPOTENCY_CONFIG.headerName,
      lockTimeout: this.options.lockTimeout ?? DEFAULT_IDEMPOTENCY_CONFIG.lockTimeout,
      waitTimeout: this.options.waitTimeout ?? DEFAULT_IDEMPOTENCY_CONFIG.waitTimeout,
      validateFingerprint: this.options.validateFingerprint ?? DEFAULT_IDEMPOTENCY_CONFIG.validateFingerprint,
      fingerprintFields: this.options.fingerprintFields ?? DEFAULT_IDEMPOTENCY_CONFIG.fingerprintFields,
      errorPolicy: this.options.errorPolicy ?? DEFAULT_IDEMPOTENCY_CONFIG.errorPolicy,
      fingerprintGenerator: this.options.fingerprintGenerator,
    };

    return [
      { provide: IDEMPOTENCY_PLUGIN_OPTIONS, useValue: config },
      { provide: IDEMPOTENCY_STORE, useClass: RedisIdempotencyStoreAdapter },
      { provide: IDEMPOTENCY_SERVICE, useClass: IdempotencyService },
      // Reflector is needed for @Idempotent decorator metadata
      Reflector,
      IdempotencyInterceptor,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_SERVICE, IdempotencyInterceptor];
  }
}
