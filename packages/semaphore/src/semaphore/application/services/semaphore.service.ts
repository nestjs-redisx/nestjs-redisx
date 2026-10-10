import { Injectable, Inject, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

import { SEMAPHORE_PLUGIN_OPTIONS, SEMAPHORE_STORE, DEFAULT_SEMAPHORE_CONFIG } from '../../../shared/constants';
import { SemaphoreAcquisitionError } from '../../../shared/errors';
import { ISemaphorePluginOptions, ISemaphoreOptions } from '../../../shared/types';
import { validateSemaphoreCall, validateSemaphoreCallOptions, validateSemaphoreOptions } from '../../../shared/utils/validate-semaphore-options';
import { SemaphorePermit, ISemaphorePermit } from '../../domain/entities/semaphore-permit.entity';
import { ISemaphoreService } from '../ports/semaphore-service.port';
import { ISemaphoreStore } from '../ports/semaphore-store.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  incrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
  decrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
}

// Optional tracing integration
const TRACING_SERVICE = Symbol.for('TRACING_SERVICE');

interface ISpan {
  setAttribute(key: string, value: unknown): this;
  setStatus(status: 'OK' | 'ERROR'): this;
  recordException(error: Error): this;
  end(): void;
}

interface ITracingService {
  startSpan(name: string, options?: { kind?: string; attributes?: Record<string, unknown> }): ISpan;
}

/**
 * Semaphore service implementation.
 *
 * Bound concurrency across instances: at most `permits` live holders per
 * key, with exponential-backoff acquisition, leased permits (TTL frees
 * crashed holders), optional auto-renewal, and graceful shutdown that
 * releases every permit this instance still holds.
 */
@Injectable()
export class SemaphoreService implements ISemaphoreService, OnModuleDestroy {
  private readonly logger = new Logger(SemaphoreService.name);
  private readonly activePermits = new Set<SemaphorePermit>();
  /**
   * Terminal flag: an acquire sleeping in backoff when the service is
   * destroyed must not win a seat afterwards (nothing would ever release it
   * — on a still-alive process its unref'd auto-renew would keep the seat
   * forever).
   */
  private destroyed = false;

  constructor(
    @Inject(SEMAPHORE_PLUGIN_OPTIONS) private readonly config: ISemaphorePluginOptions,
    @Inject(SEMAPHORE_STORE) private readonly store: ISemaphoreStore,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
    @Optional() @Inject(TRACING_SERVICE) private readonly tracing?: ITracingService,
  ) {
    // The service is exported for direct wiring too — validate here as well
    // as in the plugin, so a hand-constructed service fails fast (leader
    // lesson: plugin-only validation let invalid hand-wired configs through).
    validateSemaphoreOptions(config, 'SemaphoreService');
  }

  /**
   * Lifecycle hook. Deliberately does NOT release still-held permits: a
   * permit guards work that may STILL BE RUNNING when Nest fires the destroy
   * hooks (in-flight handlers are not drained first), and yanking the seat
   * would let another instance start the same bounded work concurrently — a
   * silent violation of the one invariant this package sells. Instead:
   * auto-renewal stops, so every seat of this instance lapses within its
   * remaining TTL — exactly the documented crash bound. Work that finishes
   * before the process exits still releases instantly through its own
   * finally; an acquire still sleeping in backoff is aborted by the
   * `destroyed` flag.
   */
  onModuleDestroy(): void {
    this.destroyed = true;
    for (const permit of this.activePermits) {
      permit.stopAutoRenew();
    }
    if (this.activePermits.size > 0) {
      this.logger.log(`Shutdown: ${this.activePermits.size} semaphore permit(s) left to lapse by TTL (crash bound); completed work still releases instantly.`);
    }
    this.activePermits.clear();
  }

  /**
   * Acquires a permit with exponential-backoff retry.
   */
  async acquire(key: string, permits: number, options: ISemaphoreOptions = {}): Promise<ISemaphorePermit> {
    validateSemaphoreCall(key, permits, 'acquire');
    validateSemaphoreCallOptions(options, 'acquire');

    const span = this.quietly(() =>
      this.tracing?.startSpan('semaphore.acquire', {
        kind: 'INTERNAL',
        attributes: { 'semaphore.key': key, 'semaphore.permits': permits, 'semaphore.ttl': options.ttl },
      }),
    );

    const fullKey = this.buildKey(key);
    const ttl = this.resolveTtl(options.ttl);
    const permitId = this.generatePermitId();
    const retry = this.resolveRetryConfig(options);
    const waitTimeout = options.waitTimeout;
    const startTime = Date.now();

    let delay = retry.initialDelay;

    try {
      for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
        if (this.destroyed) {
          throw new SemaphoreAcquisitionError(key, 'shutdown');
        }

        let acquired: boolean;
        try {
          acquired = await this.store.acquire(fullKey, permitId, permits, ttl);
        } catch (storeError) {
          // Typed wrapping: the decorator's onUnavailable policy and
          // withPermit callers must see the package's error (with the driver
          // failure as the cause), not a raw ReplyError.
          throw new SemaphoreAcquisitionError(key, 'error', storeError instanceof Error ? storeError : new Error(String(storeError)));
        }

        if (acquired && this.destroyed) {
          // Won on the wire while shutdown ran: nothing would ever release
          // this seat — give it back quietly and abort.
          await Promise.resolve(this.store.release(fullKey, permitId)).catch(() => undefined);
          throw new SemaphoreAcquisitionError(key, 'shutdown');
        }

        if (acquired) {
          const waitDuration = (Date.now() - startTime) / 1000;
          this.quietly(() => this.metrics?.observeHistogram('redisx_semaphore_wait_duration_seconds', waitDuration));
          this.quietly(() => this.metrics?.incrementCounter('redisx_semaphore_acquisitions_total', { status: 'acquired' }));
          this.quietly(() => this.metrics?.incrementGauge('redisx_semaphore_permits_active'));

          this.quietly(() =>
            span
              ?.setAttribute('semaphore.acquired', true)
              .setAttribute('semaphore.attempts', attempt + 1)
              .setStatus('OK'),
          );

          const permit = this.createPermit(fullKey, permitId, ttl, options);
          this.activePermits.add(permit);
          return permit;
        }

        // Stop when the retry cap is reached, or when sleeping again would
        // push the total wait past the caller's waitTimeout budget.
        const waitBudgetExhausted = waitTimeout !== undefined && Date.now() - startTime + delay >= waitTimeout;

        if (attempt === retry.maxRetries || waitBudgetExhausted) {
          this.quietly(() => this.metrics?.incrementCounter('redisx_semaphore_acquisitions_total', { status: 'failed' }));
          this.quietly(() =>
            span
              ?.setAttribute('semaphore.acquired', false)
              .setAttribute('semaphore.attempts', attempt + 1)
              .setStatus('ERROR'),
          );
          // 'timeout' only when the caller's wait budget ran out; a plain
          // retry-cap exhaustion is 'exhausted' (distinct error codes, so
          // consumers can back off differently).
          throw new SemaphoreAcquisitionError(key, waitBudgetExhausted ? 'timeout' : 'exhausted');
        }

        await this.sleep(delay);
        delay = Math.min(delay * retry.multiplier, retry.maxDelay);
      }

      // Unreachable (the loop exits via return or throw), but satisfy TS.
      this.quietly(() => this.metrics?.incrementCounter('redisx_semaphore_acquisitions_total', { status: 'failed' }));
      throw new SemaphoreAcquisitionError(key, 'exhausted');
    } catch (error) {
      this.quietly(() => span?.recordException(error as Error).setStatus('ERROR'));
      throw error;
    } finally {
      this.quietly(() => span?.end());
    }
  }

  /**
   * Attempts to acquire a permit once, without retry.
   */
  async tryAcquire(key: string, permits: number, options: ISemaphoreOptions = {}): Promise<ISemaphorePermit | null> {
    validateSemaphoreCall(key, permits, 'tryAcquire');
    validateSemaphoreCallOptions(options, 'tryAcquire');

    const fullKey = this.buildKey(key);
    const ttl = this.resolveTtl(options.ttl);
    const permitId = this.generatePermitId();

    if (this.destroyed) {
      throw new SemaphoreAcquisitionError(key, 'shutdown');
    }

    let acquired: boolean;
    try {
      acquired = await this.store.acquire(fullKey, permitId, permits, ttl);
    } catch (storeError) {
      throw new SemaphoreAcquisitionError(key, 'error', storeError instanceof Error ? storeError : new Error(String(storeError)));
    }

    if (acquired && this.destroyed) {
      await Promise.resolve(this.store.release(fullKey, permitId)).catch(() => undefined);
      throw new SemaphoreAcquisitionError(key, 'shutdown');
    }

    if (!acquired) {
      this.quietly(() => this.metrics?.incrementCounter('redisx_semaphore_acquisitions_total', { status: 'failed' }));
      return null;
    }

    this.quietly(() => this.metrics?.incrementCounter('redisx_semaphore_acquisitions_total', { status: 'acquired' }));
    this.quietly(() => this.metrics?.incrementGauge('redisx_semaphore_permits_active'));

    const permit = this.createPermit(fullKey, permitId, ttl, options);
    this.activePermits.add(permit);
    return permit;
  }

  /**
   * Executes a function while holding a permit; always releases afterwards.
   */
  async withPermit<T>(key: string, permits: number, fn: () => Promise<T>, options: ISemaphoreOptions = {}): Promise<T> {
    const permit = await this.acquire(key, permits, options);
    const holdStart = Date.now();

    try {
      return await fn();
    } finally {
      const holdDuration = (Date.now() - holdStart) / 1000;
      this.quietly(() => this.metrics?.observeHistogram('redisx_semaphore_hold_duration_seconds', holdDuration));

      await permit
        .release()
        .catch((error) => {
          this.logger.error(`Semaphore permit release failed for ${key}:`, error);
        })
        .finally(() => {
          this.activePermits.delete(permit as SemaphorePermit);
        });
    }
  }

  /**
   * Counts currently held (unexpired) permits for a key.
   */
  async usedPermits(key: string): Promise<number> {
    validateSemaphoreCall(key, 1, 'usedPermits');
    return this.store.usedPermits(this.buildKey(key));
  }

  /**
   * Computes free capacity for a key at the given capacity.
   */
  async availablePermits(key: string, permits: number): Promise<number> {
    validateSemaphoreCall(key, permits, 'availablePermits');
    const used = await this.store.usedPermits(this.buildKey(key));
    return Math.max(0, permits - used);
  }

  /**
   * Force-releases every permit on a key (admin operation).
   */
  async forceReleaseAll(key: string): Promise<number> {
    validateSemaphoreCall(key, 1, 'forceReleaseAll');
    return this.store.forceReleaseAll(this.buildKey(key));
  }

  /**
   * Containment for user-extensible observability (metrics, tracing): a
   * throwing implementation must never break semaphore semantics — on the
   * success path it would otherwise leak a seat already granted in Redis
   * with no permit handed to the caller (nobody can release it until the
   * TTL). Same total-containment bar the leader plugin hardened to.
   */
  private quietly<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  /**
   * Creates the permit entity with optional auto-renewal, mirroring the
   * release in metrics (gauge) when the permit is released directly.
   */
  private createPermit(fullKey: string, permitId: string, ttl: number, options: ISemaphoreOptions): SemaphorePermit {
    const permit = new SemaphorePermit(fullKey, permitId, ttl, this.store);

    const autoRenewEnabled = options.autoRenew ?? this.config.autoRenew?.enabled ?? DEFAULT_SEMAPHORE_CONFIG.autoRenew.enabled;
    if (autoRenewEnabled && !this.destroyed) {
      const intervalFraction = this.config.autoRenew?.intervalFraction ?? DEFAULT_SEMAPHORE_CONFIG.autoRenew.intervalFraction;
      permit.startAutoRenew(ttl * intervalFraction);
    }

    // Track the active gauge symmetrically for DIRECT releases too (not only
    // withPermit): wrap release once, keeping the entity metric-free.
    const originalRelease = permit.release.bind(permit);
    let gaugeSettled = false;
    permit.release = async () => {
      try {
        await originalRelease();
      } finally {
        if (!gaugeSettled) {
          gaugeSettled = true;
          this.quietly(() => this.metrics?.decrementGauge('redisx_semaphore_permits_active'));
          this.activePermits.delete(permit);
        }
      }
    };

    return permit;
  }

  /**
   * Builds the full semaphore key with the configured prefix.
   */
  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? DEFAULT_SEMAPHORE_CONFIG.keyPrefix;
    return `${prefix}${key}`;
  }

  /**
   * Generates a unique permit id.
   */
  private generatePermitId(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Resolves the TTL with defaults and the maxTtl cap.
   */
  private resolveTtl(ttl?: number): number {
    const resolved = ttl ?? this.config.defaultTtl ?? DEFAULT_SEMAPHORE_CONFIG.defaultTtl;
    const maxTtl = this.config.maxTtl ?? DEFAULT_SEMAPHORE_CONFIG.maxTtl;
    return Math.min(resolved, maxTtl);
  }

  /**
   * Resolves the retry configuration (per-call overrides over plugin config).
   */
  private resolveRetryConfig(options: ISemaphoreOptions) {
    return {
      maxRetries: options.retry?.maxRetries ?? this.config.retry?.maxRetries ?? DEFAULT_SEMAPHORE_CONFIG.retry.maxRetries,
      initialDelay: options.retry?.initialDelay ?? this.config.retry?.initialDelay ?? DEFAULT_SEMAPHORE_CONFIG.retry.initialDelay,
      maxDelay: this.config.retry?.maxDelay ?? DEFAULT_SEMAPHORE_CONFIG.retry.maxDelay,
      multiplier: this.config.retry?.multiplier ?? DEFAULT_SEMAPHORE_CONFIG.retry.multiplier,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Never keep a dying process alive for a backoff nap.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });
  }
}
