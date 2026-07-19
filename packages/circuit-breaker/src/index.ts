// Domain — types & contract
export type { CircuitState, ICircuitBreakerConfig, ICircuitSnapshot, ICircuitBreakerState } from './circuit-breaker/domain/circuit-breaker-state.interface';

// Errors
export { InvalidCircuitBreakerConfigError } from './circuit-breaker/shared/errors';

// Constants (DI tokens — used by the service/store layer in a later step)
export { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_SERVICE, CIRCUIT_BREAKER_STORE, CIRCUIT_BREAKER_REDIS_DRIVER } from './circuit-breaker/shared/constants';
