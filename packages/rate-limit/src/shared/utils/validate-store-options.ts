import { InvalidRateLimitConfigError } from '../errors';
import { IRateLimitMemoryOptions, RateLimitStoreType } from '../types';

const STORE_TYPES: readonly RateLimitStoreType[] = ['redis', 'memory'];

/**
 * Validates a `store` value from plugin options or a per-call config.
 * Fail-fast: configuration mistakes must never be masked by the errorPolicy.
 */
export function validateStoreType(store: unknown, source: string): void {
  if (store === undefined) {
    return;
  }
  if (!STORE_TYPES.includes(store as RateLimitStoreType)) {
    throw new InvalidRateLimitConfigError(`${source}: "store" must be one of ${STORE_TYPES.map((s) => `'${s}'`).join(' | ')}, got ${JSON.stringify(store)}.`);
  }
}

/**
 * Validates memory-store sizing options.
 */
export function validateMemoryOptions(memory: IRateLimitMemoryOptions | undefined, source: string): void {
  if (memory === undefined) {
    return;
  }
  if (memory.maxKeys !== undefined && (!Number.isSafeInteger(memory.maxKeys) || memory.maxKeys <= 0)) {
    throw new InvalidRateLimitConfigError(`${source}: "memory.maxKeys" must be a positive integer, got ${JSON.stringify(memory.maxKeys)}.`);
  }
  if (memory.sweepIntervalMs !== undefined && (!Number.isSafeInteger(memory.sweepIntervalMs) || memory.sweepIntervalMs <= 0)) {
    throw new InvalidRateLimitConfigError(`${source}: "memory.sweepIntervalMs" must be a positive integer (milliseconds), got ${JSON.stringify(memory.sweepIntervalMs)}.`);
  }
}
