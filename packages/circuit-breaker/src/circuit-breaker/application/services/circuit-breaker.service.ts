import { Injectable, Inject, Logger } from '@nestjs/common';

import { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_STORE, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../../shared/constants';
import { CircuitBreakerOpenError } from '../../../shared/errors';
import { ICircuitBreakerConfig, ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';
import { validateCircuitBreakerConfig } from '../../domain/validate-circuit-breaker-config';
import { ICircuitBreakerExecuteOptions, ICircuitBreakerOptions, ICircuitBreakerPluginOptions } from '../../../shared/types';
import { ICircuitBreakerService } from '../ports/circuit-breaker-service.port';
import { ICircuitBreakerStore } from '../ports/circuit-breaker-store.port';

/**
 * Circuit breaker service implementation.
 * Guards calls with a distributed breaker backed by the state store.
 *
 * Error semantics:
 * - execute(): a store failure on the canRequest gate is governed by
 *   `errorPolicy` (fail-open runs `fn`, fail-closed throws); store failures
 *   while recording the outcome are logged and never mask `fn`'s own result.
 * - manual API (recordSuccess/recordFailure/getState/reset): ALWAYS strict —
 *   store failures throw CircuitBreakerStoreError regardless of `errorPolicy`
 *   (there is no meaningful "open" fallback for an explicit state operation).
 * - invalid configuration (plugin options or per-call overrides) always throws
 *   InvalidCircuitBreakerConfigError — a programmer error is never subject to
 *   errorPolicy.
 */
@Injectable()
export class CircuitBreakerService implements ICircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    @Inject(CIRCUIT_BREAKER_PLUGIN_OPTIONS)
    private readonly config: ICircuitBreakerPluginOptions,
    @Inject(CIRCUIT_BREAKER_STORE)
    private readonly store: ICircuitBreakerStore,
  ) {}

  async execute<T>(key: string, fn: () => Promise<T>, options: ICircuitBreakerExecuteOptions<T> = {}): Promise<T> {
    const cfg = this.resolveConfig(options);
    const fullKey = this.buildKey(key);

    let allowed: boolean;
    let snapshot: ICircuitSnapshot;
    try {
      const decision = await this.store.canRequest(fullKey, cfg);
      allowed = decision.allowed;
      snapshot = decision.snapshot;
    } catch (error) {
      // Store failure -> apply errorPolicy (mirrors rate-limit).
      if ((this.config.errorPolicy ?? 'fail-closed') === 'fail-open') {
        this.logger.warn(`Circuit breaker store unavailable for "${fullKey}", failing open: ${(error as Error).message}`);
        return fn();
      }
      throw error;
    }

    if (!allowed) {
      return this.reject(fullKey, snapshot, options);
    }

    try {
      const result = await fn();
      await this.safeRecordSuccess(fullKey, cfg);
      return result;
    } catch (error) {
      await this.safeRecordFailure(fullKey, cfg);
      throw error;
    }
  }

  async recordSuccess(key: string, options: ICircuitBreakerOptions = {}): Promise<ICircuitSnapshot> {
    return this.store.recordSuccess(this.buildKey(key), this.resolveConfig(options));
  }

  async recordFailure(key: string, options: ICircuitBreakerOptions = {}): Promise<ICircuitSnapshot> {
    return this.store.recordFailure(this.buildKey(key), this.resolveConfig(options));
  }

  async getState(key: string, options: ICircuitBreakerOptions = {}): Promise<ICircuitSnapshot> {
    return this.store.getState(this.buildKey(key), this.resolveConfig(options));
  }

  async reset(key: string): Promise<void> {
    return this.store.reset(this.buildKey(key));
  }

  /**
   * Reject a call because the breaker is OPEN (or probes exhausted).
   */
  private async reject<T>(key: string, snapshot: ICircuitSnapshot, options: ICircuitBreakerExecuteOptions<T>): Promise<T> {
    if (options.fallback) {
      return options.fallback();
    }
    const factory = options.errorFactory ?? this.config.errorFactory;
    throw factory ? factory(key, snapshot) : new CircuitBreakerOpenError(key, snapshot);
  }

  /**
   * Record success without masking the guarded call's result on store errors.
   *
   * NOTE: if this fails while the breaker is HALF_OPEN, the consumed probe slot
   * is not released; the circuit can stay half-open (rejecting calls once the
   * probe budget is exhausted) until the state key's TTL self-heals it. The
   * log message points operators at reset() as the immediate remedy.
   */
  private async safeRecordSuccess(key: string, cfg: ICircuitBreakerConfig): Promise<void> {
    try {
      await this.store.recordSuccess(key, cfg);
    } catch (error) {
      this.logger.error(`Failed to record success for "${key}": ${(error as Error).message}. ` + `If the circuit was HALF_OPEN its probe slot may stay consumed until the state TTL expires — reset("${key}") clears it immediately.`);
    }
  }

  /**
   * Record failure without masking the guarded call's error on store errors.
   * Same HALF_OPEN probe-slot caveat as safeRecordSuccess.
   */
  private async safeRecordFailure(key: string, cfg: ICircuitBreakerConfig): Promise<void> {
    try {
      await this.store.recordFailure(key, cfg);
    } catch (error) {
      this.logger.error(`Failed to record failure for "${key}": ${(error as Error).message}. ` + `If the circuit was HALF_OPEN its probe slot may stay consumed until the state TTL expires — reset("${key}") clears it immediately.`);
    }
  }

  /**
   * Merge per-call overrides over plugin options over package defaults, then
   * validate — an invalid config must never reach the Lua scripts.
   *
   * @throws {InvalidCircuitBreakerConfigError} on invalid values
   */
  private resolveConfig(options: ICircuitBreakerOptions): ICircuitBreakerConfig {
    const resolved: ICircuitBreakerConfig = {
      failureThreshold: options.failureThreshold ?? this.config.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      windowMs: options.windowMs ?? this.config.windowMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.windowMs,
      openDurationMs: options.openDurationMs ?? this.config.openDurationMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.openDurationMs,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? this.config.halfOpenMaxCalls ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenMaxCalls,
      successThreshold: options.successThreshold ?? this.config.successThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold,
    };
    validateCircuitBreakerConfig(resolved);
    return resolved;
  }

  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.keyPrefix;
    return `${prefix}${key}`;
  }
}
