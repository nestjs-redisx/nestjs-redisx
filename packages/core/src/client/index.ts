/**
 * Client module barrel export.
 *
 * Exports client manager and related types.
 */

// Application
export { RedisClientManager } from './application/redis-client.manager';

// Domain - Interfaces
export type { IRedisDriverManager, IManagerEventData, ManagerEventHandler } from './domain/interfaces/client-manager.interface';
export { ManagerEvent } from './domain/interfaces/client-manager.interface';

// Domain - Types
export type { IHealthStatus, IConnectionStats, IClientStats, IReconnectionOptions } from './domain/types/health.types';
