import { InvalidCounterConfigError } from '../errors';
import { ICountersPluginOptions } from '../types';

function describe(value: unknown): string {
  if (typeof value === 'number') {
    return String(value); // NaN/Infinity render truthfully
  }
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/**
 * Validates a counter key at the call site (fail-fast on every public API).
 */
export function validateCounterKey(key: unknown, source: string): void {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new InvalidCounterConfigError(`${source}: key must be a non-empty string, got ${describe(key)}.`);
  }
}

/**
 * Validates a mutation amount: a non-zero safe integer (Redis counters are
 * 64-bit integers; fractional or unsafe values corrupt silently).
 */
export function validateCounterAmount(by: unknown, source: string): void {
  if (typeof by !== 'number' || !Number.isSafeInteger(by) || by === 0) {
    throw new InvalidCounterConfigError(`${source}: amount must be a non-zero safe integer, got ${describe(by)}.`);
  }
}

/**
 * Validates an absolute value for set().
 */
export function validateCounterValue(value: unknown, source: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new InvalidCounterConfigError(`${source}: value must be a safe integer, got ${describe(value)}.`);
  }
}

/**
 * Validates an optional window TTL.
 */
export function validateCounterTtl(ttl: number | undefined, source: string): void {
  if (ttl !== undefined && (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl <= 0)) {
    throw new InvalidCounterConfigError(`${source}: ttl must be a positive integer (milliseconds), got ${describe(ttl)}.`);
  }
}

/**
 * Validates merged plugin options (fail-fast at registration time, on both
 * the sync and registerAsync paths).
 */
export function validateCountersOptions(options: ICountersPluginOptions, source = 'CountersPlugin'): void {
  if (options.keyPrefix !== undefined && (typeof options.keyPrefix !== 'string' || options.keyPrefix.length === 0)) {
    // An empty prefix would make a counter key a bare user string — the
    // same self-collision hazard the leader plugin guards against.
    throw new InvalidCounterConfigError(`${source}: keyPrefix must be a non-empty string, got ${describe(options.keyPrefix)}.`);
  }
}
