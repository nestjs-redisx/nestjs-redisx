/**
 * Driver abstraction barrel export.
 */

// Infrastructure
export { BaseRedisDriver } from './infrastructure/base.driver';
export { IoRedisAdapter } from './infrastructure/ioredis.adapter';
export { NodeRedisAdapter } from './infrastructure/node-redis.adapter';

// Application
export { createDriver, createDrivers, detectAvailableDriver, getRecommendedDriver, DriverFactory, type IDriverFactoryOptions } from './application/driver.factory';
