/**
 * Shared fail-fast configuration validation.
 * Called from the plugin's mergeDefaults (both sync and async paths); an
 * invalid config must never reach the store.
 */

import { InvalidSessionConfigError } from '../../shared/errors';
import { SessionLimitPolicy } from '../../shared/types';

/**
 * The subset of resolved options that requires validation.
 */
export interface IValidatableSessionConfig {
  keyPrefix: string;
  defaultTtlMs: number;
  absoluteLifetimeMs?: number;
  maxSessionsPerUser?: number;
  maxSessionsPolicy: SessionLimitPolicy;
  userIdExtractor: (session: unknown) => string | undefined;
}

const LIMIT_POLICIES: readonly SessionLimitPolicy[] = ['reject', 'evict-oldest'];

/**
 * Validates a resolved session configuration.
 *
 * @param config - Resolved (post-merge) configuration
 * @throws {InvalidSessionConfigError} When any knob is out of range
 */
export function validateSessionConfig(config: IValidatableSessionConfig): void {
  if (typeof config.keyPrefix !== 'string' || config.keyPrefix.length === 0) {
    throw new InvalidSessionConfigError('keyPrefix must be a non-empty string');
  }

  if (!isPositiveInteger(config.defaultTtlMs)) {
    throw new InvalidSessionConfigError(`defaultTtlMs must be a positive integer (got ${config.defaultTtlMs})`);
  }

  if (config.absoluteLifetimeMs !== undefined && !isPositiveInteger(config.absoluteLifetimeMs)) {
    throw new InvalidSessionConfigError(`absoluteLifetimeMs must be a positive integer when set (got ${config.absoluteLifetimeMs})`);
  }

  if (config.maxSessionsPerUser !== undefined && !isPositiveInteger(config.maxSessionsPerUser)) {
    throw new InvalidSessionConfigError(`maxSessionsPerUser must be a positive integer when set (got ${config.maxSessionsPerUser})`);
  }

  if (!LIMIT_POLICIES.includes(config.maxSessionsPolicy)) {
    throw new InvalidSessionConfigError(`maxSessionsPolicy must be one of ${LIMIT_POLICIES.join(', ')} (got ${String(config.maxSessionsPolicy)})`);
  }

  if (typeof config.userIdExtractor !== 'function') {
    throw new InvalidSessionConfigError('userIdExtractor must be a function');
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
