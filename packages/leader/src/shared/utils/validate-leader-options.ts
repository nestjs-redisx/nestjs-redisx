import { DEFAULT_LEADER_CONFIG, MAX_LEADER_TTL_MS } from '../constants';
import { InvalidLeaderConfigError } from '../errors';
import { ILeaderPluginOptions } from '../types';

function assertPositiveInt(value: number | undefined, name: string, source: string): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LEADER_TTL_MS) {
    throw new InvalidLeaderConfigError(`${source}: "${name}" must be a positive integer (ms, <= ${MAX_LEADER_TTL_MS}), got ${JSON.stringify(value)}.`);
  }
}

/**
 * Validates a group name used in options, decorators, and per-call APIs.
 * Fail-fast: configuration mistakes are never swallowed by the election loop.
 */
export function validateLeaderGroup(group: unknown, source: string): void {
  if (typeof group !== 'string' || group.trim().length === 0) {
    throw new InvalidLeaderConfigError(`${source}: group must be a non-empty string, got ${JSON.stringify(group)}.`);
  }
}

/**
 * Validates plugin options (sync AND async construction paths).
 */
export function validateLeaderOptions(options: ILeaderPluginOptions, source: string): void {
  assertPositiveInt(options.ttlMs, 'ttlMs', source);
  assertPositiveInt(options.renewIntervalMs, 'renewIntervalMs', source);
  assertPositiveInt(options.retryIntervalMs, 'retryIntervalMs', source);

  const effectiveTtl = options.ttlMs ?? DEFAULT_LEADER_CONFIG.ttlMs;
  const effectiveRenew = options.renewIntervalMs ?? DEFAULT_LEADER_CONFIG.renewIntervalMs;
  if (effectiveRenew >= effectiveTtl) {
    throw new InvalidLeaderConfigError(`${source}: "renewIntervalMs" (${effectiveRenew}) must be strictly less than "ttlMs" (${effectiveTtl}) — otherwise the lease expires before its own heartbeat.`);
  }

  if (options.groups !== undefined) {
    if (!Array.isArray(options.groups)) {
      throw new InvalidLeaderConfigError(`${source}: "groups" must be an array of non-empty strings.`);
    }
    for (const group of options.groups) {
      validateLeaderGroup(group, source);
    }
  }

  if (options.instanceId !== undefined && (typeof options.instanceId !== 'string' || options.instanceId.trim().length === 0)) {
    throw new InvalidLeaderConfigError(`${source}: "instanceId" must be a non-empty string when provided.`);
  }
}
