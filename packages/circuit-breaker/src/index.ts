// Plugin
export { CircuitBreakerPlugin } from './circuit-breaker.plugin';

// Services
export { CircuitBreakerService } from './circuit-breaker/application/services/circuit-breaker.service';

// Ports (Interfaces)
export type { ICircuitBreakerService } from './circuit-breaker/application/ports/circuit-breaker-service.port';
export type { ICircuitBreakerStore } from './circuit-breaker/application/ports/circuit-breaker-store.port';

// Decorators
export { WithCircuitBreaker, type IWithCircuitBreakerOptions, WITH_CIRCUIT_BREAKER_OPTIONS, registerCircuitBreakerServiceGetter } from './circuit-breaker/api/decorators/with-circuit-breaker.decorator';

// Domain — types & contract
export type { CircuitState, ICircuitBreakerConfig, ICircuitSnapshot, ICircuitBreakerState } from './circuit-breaker/domain/circuit-breaker-state.interface';

// Domain — state machine
export { CircuitBreakerState } from './circuit-breaker/domain/circuit-breaker-state';

// Types
export type { ICircuitBreakerPluginOptions, ICircuitBreakerOptions, ICircuitBreakerExecuteOptions, ICircuitBreakerDecision, CircuitBreakerPluginOptions, CircuitBreakerOptions } from './circuit-breaker/shared/types';

// Errors
export { CircuitBreakerError, CircuitBreakerOpenError, CircuitBreakerStoreError, InvalidCircuitBreakerConfigError } from './circuit-breaker/shared/errors';

// Constants (DI tokens)
export { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_SERVICE, CIRCUIT_BREAKER_STORE, CIRCUIT_BREAKER_REDIS_DRIVER } from './circuit-breaker/shared/constants';
