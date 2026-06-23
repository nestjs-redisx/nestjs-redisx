/**
 * @nestjs-redisx/testing
 *
 * In-memory Redis driver and testing utilities for unit-testing NestJS RedisX
 * code (cache, locks, rate-limit, idempotency) without a running Redis.
 *
 * Importing this package registers the `'memory'` driver with the core driver
 * registry as a side effect.
 */
import { registerMemoryDriver } from './memory/api/register-memory-driver';

// Register the in-memory driver on import.
registerMemoryDriver();

// API
export { RedisTestingModule, type RedisTestingModuleOptions, type RedisTestingModuleAsyncOptions } from './memory/api/redis-testing.module';
export { registerMemoryDriver } from './memory/api/register-memory-driver';

// Infrastructure
export { MemoryRedisAdapter } from './memory/infrastructure/adapters/memory-redis.adapter';

// Domain (advanced/direct use)
export { MemoryStore } from './memory/domain/store/memory-store';
export { LuaInterpreter } from './memory/domain/lua/lua-interpreter';
export { CommandExecutor } from './memory/application/services/command-executor.service';

// Shared
export { MEMORY_DRIVER_TYPE } from './shared/constants';
export { MemoryDriverError, LuaExecutionError, WrongTypeError } from './shared/errors';
export type { IMemoryDriverOptions } from './shared/types';
