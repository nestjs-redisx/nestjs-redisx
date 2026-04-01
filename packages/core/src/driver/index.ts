/**
 * Driver abstraction barrel export.
 */

// Infrastructure
export { BaseRedisDriver } from './infrastructure/base.driver';

// Application
export { createDriver, createDrivers, detectAvailableDriver, getRecommendedDriver, DriverFactory, type IDriverFactoryOptions } from './application/driver.factory';
