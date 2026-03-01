/**
 * @nestjs-redisx/core
 *
 * Core module with driver abstraction and plugin system for NestJS RedisX.
 */

export { RedisModule } from './api/redis.module';
export { RedisService } from './application/redis.service';
export { InjectRedis } from './api/decorators/inject-redis.decorator';

export * from './types';

export * from './interfaces';

export * from './driver';

export * from './client';

export type { IRedisXPlugin, IPluginAsyncOptions, IPluginContext } from './plugin/domain/interfaces';
export { PluginRegistryService } from './plugin/application/plugin-registry.service';

export * from './errors';

export * from './shared/errors';
export * from './shared/constants';
export * from './shared/types';

export { REDIS_MODULE_OPTIONS, REDIS_CLIENT, REDIS_CLIENTS_MAP, REDIS_DRIVER, REDIS_CLIENTS_INITIALIZATION, REDISX_CONFIG, CLIENT_MANAGER, PLUGIN_REGISTRY, REGISTERED_PLUGINS, REDISX_LOGGER, getClientToken, getDriverToken, DEFAULT_CLIENT_NAME } from './shared/constants';
