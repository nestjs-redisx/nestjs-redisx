// Plugin
export { CountersPlugin } from './counters.plugin';

// Services
export { CounterService } from './counter/application/services/counter.service';

// Ports (Interfaces)
export type { ICounterService } from './counter/application/ports/counter-service.port';
export type { ICounterStore } from './counter/application/ports/counter-store.port';

// Types
export type { ICountersPluginOptions, CountersPluginOptions, ICounterOptions } from './shared/types';

// Errors
export { CounterError, InvalidCounterConfigError, CounterValueError } from './shared/errors';

// Constants
export { COUNTER_SERVICE, COUNTER_STORE, COUNTERS_REDIS_DRIVER, COUNTERS_PLUGIN_OPTIONS } from './shared/constants';
