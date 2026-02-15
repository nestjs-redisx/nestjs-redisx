import { Injectable, Inject, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

import { LOCKS_PLUGIN_OPTIONS, LOCK_STORE } from '../../../shared/constants';
import { LockAcquisitionError } from '../../../shared/errors';
import { ILocksPluginOptions, ILockOptions } from '../../../shared/types';
import { Lock, ILock } from '../../domain/entities/lock.entity';
import { ILockService } from '../ports/lock-service.port';
import { ILockStore } from '../ports/lock-store.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  incrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
  decrementGauge(name: string, labels?: Record<string, string>, value?: number): void;
}

// Optional tracing integration
const TRACING_SERVICE = Symbol.for('TRACING_SERVICE');

interface ISpan {
  setAttribute(key: string, value: unknown): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  setStatus(status: 'OK' | 'ERROR'): this;
  recordException(error: Error): this;
  end(): void;
}

interface ITracingService {
  startSpan(name: string, options?: { kind?: string; attributes?: Record<string, unknown> }): ISpan;
}

/**
 * Lock service implementation.
 *
 * Provides distributed locking with automatic retry, timeout, and renewal.
 * Implements graceful shutdown to release all active locks on module destroy.
 */
@Injectable()
export class LockService implements ILockService, OnModuleDestroy {
  private readonly logger = new Logger(LockService.name);
  private readonly activeLocks = new Set<Lock>();

  constructor(
    @Inject(LOCKS_PLUGIN_OPTIONS) private readonly config: ILocksPluginOptions,
    @Inject(LOCK_STORE) private readonly store: ILockStore,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
    @Optional() @Inject(TRACING_SERVICE) private readonly tracing?: ITracingService,
  ) {}

  /**
   * Lifecycle hook: releases all active locks on shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    // Release all active locks on graceful shutdown
    const releasePromises = Array.from(this.activeLocks).map((lock) =>
      lock.release().catch((error) => {
        // Log but don't throw - we're shutting down
        this.logger.error(`Failed to release lock ${lock.key} during shutdown:`, error);
      }),
    );

    await Promise.all(releasePromises);
    this.activeLocks.clear();
  }

  /**
   * Acquires lock with exponential backoff retry.
   */
  async acquire(key: string, options: ILockOptions = {}): Promise<ILock> {
    const span = this.tracing?.startSpan('lock.acquire', {
      kind: 'INTERNAL',
      attributes: { 'lock.key': key, 'lock.ttl': options.ttl },
    });

    const fullKey = this.buildKey(key);
    const ttl = this.resolveTtl(options.ttl);
    const token = this.generateToken();

    const retry = this.resolveRetryConfig(options);
    const startTime = Date.now();

    let delay = retry.initialDelay;

    try {
      for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
        const acquired = await this.store.acquire(fullKey, token, ttl);

        if (acquired) {
          const waitDuration = (Date.now() - startTime) / 1000;
          this.metrics?.observeHistogram('redisx_lock_wait_duration_seconds', waitDuration);
          this.metrics?.incrementCounter('redisx_lock_acquisitions_total', { status: 'acquired' });
          this.metrics?.incrementGauge('redisx_locks_active');

          span?.setAttribute('lock.acquired', true);
          span?.setAttribute('lock.attempts', attempt + 1);
          span?.setStatus('OK');

          const lock = this.createLock(fullKey, token, ttl, options);
          this.activeLocks.add(lock);
          return lock;
        }

        // Last attempt failed
        if (attempt === retry.maxRetries) {
          this.metrics?.incrementCounter('redisx_lock_acquisitions_total', { status: 'failed' });
          span?.setAttribute('lock.acquired', false);
          span?.setAttribute('lock.attempts', attempt + 1);
          span?.setStatus('ERROR');
          throw new LockAcquisitionError(key, 'timeout');
        }

        // Wait before retry
        await this.sleep(delay);
        delay = Math.min(delay * retry.multiplier, retry.maxDelay);
      }

      // Should never reach here, but satisfy TypeScript
      this.metrics?.incrementCounter('redisx_lock_acquisitions_total', { status: 'failed' });
      throw new LockAcquisitionError(key, 'timeout');
    } catch (error) {
      span?.recordException(error as Error);
      span?.setStatus('ERROR');
      throw error;
    } finally {
      span?.end();
    }
  }

  /**
   * Tries to acquire lock once without retry.
   */
  async tryAcquire(key: string, options: ILockOptions = {}): Promise<ILock | null> {
    const fullKey = this.buildKey(key);
    const ttl = this.resolveTtl(options.ttl);
    const token = this.generateToken();

    const acquired = await this.store.acquire(fullKey, token, ttl);

    if (!acquired) {
      this.metrics?.incrementCounter('redisx_lock_acquisitions_total', { status: 'failed' });
      return null;
    }

    this.metrics?.incrementCounter('redisx_lock_acquisitions_total', { status: 'acquired' });
    this.metrics?.incrementGauge('redisx_locks_active');

    const lock = this.createLock(fullKey, token, ttl, options);
    this.activeLocks.add(lock);
    return lock;
  }

  /**
   * Executes function with automatic lock management.
   */
  async withLock<T>(key: string, fn: () => Promise<T>, options: ILockOptions = {}): Promise<T> {
    const lock = await this.acquire(key, options);
    const holdStart = Date.now();

    try {
      return await fn();
    } finally {
      const holdDuration = (Date.now() - holdStart) / 1000;
      this.metrics?.observeHistogram('redisx_lock_hold_duration_seconds', holdDuration);
      this.metrics?.decrementGauge('redisx_locks_active');

      await lock
        .release()
        .catch((error) => {
          this.logger.error(`Lock release failed for ${key}:`, error);
        })
        .finally(() => {
          this.activeLocks.delete(lock as Lock);
        });
    }
  }

  /**
   * Checks if key is locked.
   */
  async isLocked(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    return this.store.exists(fullKey);
  }

  /**
   * Force releases lock without ownership check.
   */
  async forceRelease(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    return this.store.forceRelease(fullKey);
  }

  /**
   * Creates lock instance with optional auto-renewal.
   */
  private createLock(fullKey: string, token: string, ttl: number, options: ILockOptions): Lock {
    const lock = new Lock(fullKey, token, ttl, this.store);

    // Setup auto-renew if enabled
    const autoRenewEnabled = options.autoRenew ?? this.config.autoRenew?.enabled ?? true;
    if (autoRenewEnabled) {
      const intervalFraction = this.config.autoRenew?.intervalFraction ?? 0.5;
      const interval = ttl * intervalFraction;
      lock.startAutoRenew(interval);
    }

    return lock;
  }

  /**
   * Builds full lock key with prefix.
   */
  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? '_lock:';
    return `${prefix}${key}`;
  }

  /**
   * Generates unique lock token.
   */
  private generateToken(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Resolves TTL with defaults and limits.
   */
  private resolveTtl(ttl?: number): number {
    const resolvedTtl = ttl ?? this.config.defaultTtl ?? 30000;
    const maxTtl = this.config.maxTtl ?? 300000;
    return Math.min(resolvedTtl, maxTtl);
  }

  /**
   * Resolves retry configuration.
   */
  private resolveRetryConfig(options: ILockOptions) {
    return {
      maxRetries: options.retry?.maxRetries ?? this.config.retry?.maxRetries ?? 3,
      initialDelay: options.retry?.initialDelay ?? this.config.retry?.initialDelay ?? 100,
      maxDelay: this.config.retry?.maxDelay ?? 3000,
      multiplier: this.config.retry?.multiplier ?? 2,
    };
  }

  /**
   * Sleeps for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
