import { registerDriver, type ConnectionConfig, type IDriverFactoryOptions } from '@nestjs-redisx/core';

import { MEMORY_DRIVER_TYPE } from '../../shared/constants';
import { MemoryRedisAdapter } from '../infrastructure/adapters/memory-redis.adapter';

let registered = false;

/**
 * Registers the in-memory driver under the `'memory'` type with the core driver
 * registry, so `RedisModule.forRoot({ global: { driver: 'memory' } })` works.
 *
 * Idempotent. Called automatically when `@nestjs-redisx/testing` is imported.
 */
export function registerMemoryDriver(): void {
  if (registered) return;
  registerDriver(MEMORY_DRIVER_TYPE, (config: ConnectionConfig, options?: IDriverFactoryOptions) => new MemoryRedisAdapter(config, options));
  registered = true;
}
