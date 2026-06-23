/**
 * Driver abstraction barrel export.
 */

// Infrastructure
export { BaseRedisDriver } from './infrastructure/base.driver';

// Application
export { createDriver, createDrivers, detectAvailableDriver, getRecommendedDriver, DriverFactory, registerDriver, type IDriverFactoryOptions, type DriverFactoryFn } from './application/driver.factory';
