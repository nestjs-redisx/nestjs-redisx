import { Injectable, Inject, Logger } from '@nestjs/common';

import { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_STORE } from '../../shared/constants';
import { CircuitBreakerOpenError } from '../../shared/errors';
import { ICircuitBreakerConfig, ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';
import { ICircuitBreakerExecuteOptions, ICircuitBreakerOptions, ICircuitBreakerPluginOptions } from '../../shared/types';
import { ICircuitBreakerService } from '../ports/circuit-breaker-service.port';
import { ICircuitBreakerStore } from '../ports/circuit-breaker-store.port';

/** Fallback defaults if the plugin options omit a knob. */
const DEFAULTS: ICircuitBreakerConfig = {
  failureThreshold: 5,
  windowMs: 10000,
  openDurationMs: 30000,
  halfOpenMaxCalls: 1,
  successThreshold: 1,
};

/**
 * Circuit breaker service implementation.
 * Guards calls with a distributed breaker backed by the state store.
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
   */
  private async safeRecordSuccess(key: string, cfg: ICircuitBreakerConfig): Promise<void> {
    try {
      await this.store.recordSuccess(key, cfg);
    } catch (error) {
      this.logger.error(`Failed to record success for "${key}": ${(error as Error).message}`);
    }
  }

  /**
   * Record failure without masking the guarded call's error on store errors.
   */
  private async safeRecordFailure(key: string, cfg: ICircuitBreakerConfig): Promise<void> {
    try {
      await this.store.recordFailure(key, cfg);
    } catch (error) {
      this.logger.error(`Failed to record failure for "${key}": ${(error as Error).message}`);
    }
  }

  private resolveConfig(options: ICircuitBreakerOptions): ICircuitBreakerConfig {
    return {
      failureThreshold: options.failureThreshold ?? this.config.failureThreshold ?? DEFAULTS.failureThreshold,
      windowMs: options.windowMs ?? this.config.windowMs ?? DEFAULTS.windowMs,
      openDurationMs: options.openDurationMs ?? this.config.openDurationMs ?? DEFAULTS.openDurationMs,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? this.config.halfOpenMaxCalls ?? DEFAULTS.halfOpenMaxCalls,
      successThreshold: options.successThreshold ?? this.config.successThreshold ?? DEFAULTS.successThreshold,
    };
  }

  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? 'cb:';
    return `${prefix}${key}`;
  }
}
