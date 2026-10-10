import { InvalidSemaphoreConfigError } from '../errors';
import { ISemaphorePluginOptions } from '../types';

function assertPositiveInteger(value: unknown, name: string, source: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidSemaphoreConfigError(`${source}: ${name} must be a positive integer (milliseconds), got ${describe(value)}.`);
  }
}

function describe(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : String(value); // NaN/Infinity render truthfully
  }
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/**
 * Validates a semaphore key and capacity at the call site — the service
 * calls this on every public entry point (fail-fast, never subject to any
 * error policy).
 */
export function validateSemaphoreCall(key: unknown, permits: unknown, source: string): void {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new InvalidSemaphoreConfigError(`${source}: key must be a non-empty string, got ${describe(key)}.`);
  }
  if (typeof permits !== 'number' || !Number.isSafeInteger(permits) || permits <= 0) {
    throw new InvalidSemaphoreConfigError(`${source}: permits must be a positive integer (the semaphore capacity), got ${describe(permits)}.`);
  }
}

/**
 * Validates per-call acquisition options (fail-fast): a negative or
 * fractional ttl mints an already-expired permit, a bad waitTimeout or
 * retry override corrupts the backoff loop.
 */
export function validateSemaphoreCallOptions(options: { ttl?: number; waitTimeout?: number; retry?: { maxRetries?: number; initialDelay?: number } }, source: string): void {
  if (options.ttl !== undefined) {
    assertPositiveInteger(options.ttl, 'ttl', source);
  }
  if (options.waitTimeout !== undefined) {
    assertPositiveInteger(options.waitTimeout, 'waitTimeout', source);
  }
  if (options.retry?.maxRetries !== undefined && (typeof options.retry.maxRetries !== 'number' || !Number.isSafeInteger(options.retry.maxRetries) || options.retry.maxRetries < 0)) {
    throw new InvalidSemaphoreConfigError(`${source}: retry.maxRetries must be a non-negative integer, got ${describe(options.retry.maxRetries)}.`);
  }
  if (options.retry?.initialDelay !== undefined) {
    assertPositiveInteger(options.retry.initialDelay, 'retry.initialDelay', source);
  }
}

/**
 * Validates merged plugin options (fail-fast at registration time, on both
 * the sync and registerAsync paths).
 */
export function validateSemaphoreOptions(options: ISemaphorePluginOptions, source = 'SemaphorePlugin'): void {
  if (options.keyPrefix !== undefined && (typeof options.keyPrefix !== 'string' || options.keyPrefix.length === 0)) {
    // An empty prefix would make a semaphore key a bare user string —
    // the same self-collision hazard the leader plugin guards against.
    throw new InvalidSemaphoreConfigError(`${source}: keyPrefix must be a non-empty string, got ${describe(options.keyPrefix)}.`);
  }
  if (options.defaultTtl !== undefined) {
    assertPositiveInteger(options.defaultTtl, 'defaultTtl', source);
  }
  if (options.maxTtl !== undefined) {
    assertPositiveInteger(options.maxTtl, 'maxTtl', source);
  }
  if (options.defaultTtl !== undefined && options.maxTtl !== undefined && options.defaultTtl > options.maxTtl) {
    throw new InvalidSemaphoreConfigError(`${source}: defaultTtl (${options.defaultTtl}) must not exceed maxTtl (${options.maxTtl}).`);
  }

  const retry = options.retry;
  if (retry) {
    if (retry.maxRetries !== undefined && (typeof retry.maxRetries !== 'number' || !Number.isSafeInteger(retry.maxRetries) || retry.maxRetries < 0)) {
      throw new InvalidSemaphoreConfigError(`${source}: retry.maxRetries must be a non-negative integer, got ${describe(retry.maxRetries)}.`);
    }
    if (retry.initialDelay !== undefined) {
      assertPositiveInteger(retry.initialDelay, 'retry.initialDelay', source);
    }
    if (retry.maxDelay !== undefined) {
      assertPositiveInteger(retry.maxDelay, 'retry.maxDelay', source);
    }
    if (retry.multiplier !== undefined && (typeof retry.multiplier !== 'number' || !Number.isFinite(retry.multiplier) || retry.multiplier < 1)) {
      throw new InvalidSemaphoreConfigError(`${source}: retry.multiplier must be a finite number >= 1, got ${describe(retry.multiplier)}.`);
    }
  }

  const autoRenew = options.autoRenew;
  if (autoRenew?.intervalFraction !== undefined) {
    const fraction = autoRenew.intervalFraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
      // A fraction >= 1 renews AFTER expiry (every renewal fails), <= 0 spins.
      throw new InvalidSemaphoreConfigError(`${source}: autoRenew.intervalFraction must be a number strictly between 0 and 1, got ${describe(fraction)}.`);
    }
  }
}
