/**
 * Shared validation for circuit breaker configuration.
 *
 * Used by the pure state machine (constructor), the plugin (mergeDefaults —
 * fail-fast at bootstrap) and the service (per-call overrides), so an invalid
 * config can never silently reach the Lua scripts.
 */

import { InvalidCircuitBreakerConfigError } from '../../shared/errors';
import { ICircuitBreakerConfig } from './circuit-breaker-state.interface';

/**
 * Validates a fully-resolved circuit breaker config.
 *
 * Rules (same as the ICircuitBreakerConfig JSDoc):
 * - all six knobs are integers >= 1;
 * - successThreshold <= halfOpenMaxCalls.
 *
 * @throws {InvalidCircuitBreakerConfigError} on the first violated rule
 */
export function validateCircuitBreakerConfig(config: ICircuitBreakerConfig): void {
  assertPositiveInteger('failureThreshold', config.failureThreshold);
  assertPositiveInteger('windowMs', config.windowMs);
  assertPositiveInteger('openDurationMs', config.openDurationMs);
  assertPositiveInteger('halfOpenMaxCalls', config.halfOpenMaxCalls);
  assertPositiveInteger('successThreshold', config.successThreshold);
  assertPositiveInteger('probeTimeoutMs', config.probeTimeoutMs);

  if (config.successThreshold > config.halfOpenMaxCalls) {
    throw new InvalidCircuitBreakerConfigError(`successThreshold (${config.successThreshold}) must be <= halfOpenMaxCalls (${config.halfOpenMaxCalls})`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new InvalidCircuitBreakerConfigError(`${name} must be an integer >= 1 (got ${String(value)})`);
  }
}
