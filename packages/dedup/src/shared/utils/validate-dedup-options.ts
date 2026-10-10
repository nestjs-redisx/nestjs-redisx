import { InvalidDedupConfigError } from '../errors';
import { IDedupPluginOptions } from '../types';

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
 * Validates a key and window at the call site - every public entry point
 * calls this (fail-fast, never subject to the errorPolicy).
 */
export function validateDedupCall(key: unknown, window: number | undefined, source: string): void {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new InvalidDedupConfigError(`${source}: key must be a non-empty string, got ${describe(key)}.`);
  }
  if (key.includes('\u0000')) {
    // U+0000 delimits the plugin's internal namespaces (the debounce slot) -
    // a user key containing it could collide with internal keys.
    throw new InvalidDedupConfigError(`${source}: key must not contain the NUL character (reserved for internal namespacing).`);
  }
  if (window !== undefined && (typeof window !== 'number' || !Number.isSafeInteger(window) || window <= 0)) {
    throw new InvalidDedupConfigError(`${source}: window must be a positive integer (milliseconds), got ${describe(window)}.`);
  }
}

/**
 * Validates merged plugin options (fail-fast at registration time, on both
 * the sync and registerAsync paths).
 */
export function validateDedupOptions(options: IDedupPluginOptions, source = 'DedupPlugin'): void {
  if (options.keyPrefix !== undefined && (typeof options.keyPrefix !== 'string' || options.keyPrefix.length === 0)) {
    // An empty prefix would make a marker key a bare user string - the same
    // self-collision hazard the leader plugin guards against.
    throw new InvalidDedupConfigError(`${source}: keyPrefix must be a non-empty string, got ${describe(options.keyPrefix)}.`);
  }
  if (options.defaultWindow !== undefined && (typeof options.defaultWindow !== 'number' || !Number.isSafeInteger(options.defaultWindow) || options.defaultWindow <= 0)) {
    throw new InvalidDedupConfigError(`${source}: defaultWindow must be a positive integer (milliseconds), got ${describe(options.defaultWindow)}.`);
  }
  if (options.errorPolicy !== undefined && options.errorPolicy !== 'fail-open' && options.errorPolicy !== 'fail-closed') {
    throw new InvalidDedupConfigError(`${source}: errorPolicy must be 'fail-open' or 'fail-closed', got ${describe(options.errorPolicy)}.`);
  }
}
