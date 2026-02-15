import { Injectable, Inject, Optional } from '@nestjs/common';

import { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_STORE } from '../../../shared/constants';

/** Polling interval when waiting for an in-flight idempotent request to complete. */
const POLL_INTERVAL_MS = 100;
import { IdempotencyRecordNotFoundError, IdempotencyTimeoutError } from '../../../shared/errors';
import { IIdempotencyPluginOptions, IIdempotencyRecord, IIdempotencyCheckResult, IIdempotencyResponse, IIdempotencyOptions } from '../../../shared/types';
import { IIdempotencyService } from '../ports/idempotency-service.port';
import { IIdempotencyStore } from '../ports/idempotency-store.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * Idempotency service implementation
 */
@Injectable()
export class IdempotencyService implements IIdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_PLUGIN_OPTIONS)
    private readonly config: IIdempotencyPluginOptions,
    @Inject(IDEMPOTENCY_STORE)
    private readonly store: IIdempotencyStore,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {}

  async checkAndLock(key: string, fingerprint: string, options: IIdempotencyOptions = {}): Promise<IIdempotencyCheckResult> {
    const startTime = Date.now();
    const fullKey = this.buildKey(key);
    const lockTimeout = options.lockTimeout ?? this.config.lockTimeout ?? 30000;

    const result = await this.store.checkAndLock(fullKey, fingerprint, lockTimeout);

    if (result.status === 'new') {
      this.metrics?.incrementCounter('redisx_idempotency_requests_total', { status: 'new' });
      this.recordDuration(startTime);
      return { isNew: true };
    }

    if (result.status === 'fingerprint_mismatch') {
      this.metrics?.incrementCounter('redisx_idempotency_requests_total', { status: 'mismatch' });
      this.recordDuration(startTime);
      return { isNew: false, fingerprintMismatch: true };
    }

    if (result.status === 'processing') {
      // Wait for completion
      const record = await this.waitForCompletion(fullKey);
      this.metrics?.incrementCounter('redisx_idempotency_requests_total', { status: 'replay' });
      this.recordDuration(startTime);
      return { isNew: false, record };
    }

    // completed or failed - replay from cache
    this.metrics?.incrementCounter('redisx_idempotency_requests_total', { status: 'replay' });
    this.recordDuration(startTime);
    return { isNew: false, record: result.record };
  }

  private recordDuration(startTime: number): void {
    const duration = (Date.now() - startTime) / 1000;
    this.metrics?.observeHistogram('redisx_idempotency_duration_seconds', duration);
  }

  async complete(key: string, response: IIdempotencyResponse, options: IIdempotencyOptions = {}): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttl = options.ttl ?? this.config.defaultTtl ?? 86400;

    await this.store.complete(
      fullKey,
      {
        statusCode: response.statusCode,
        response: JSON.stringify(response.body),
        headers: response.headers ? JSON.stringify(response.headers) : undefined,
        completedAt: Date.now(),
      },
      ttl,
    );
  }

  async fail(key: string, error: string): Promise<void> {
    const fullKey = this.buildKey(key);
    await this.store.fail(fullKey, error);
  }

  async get(key: string): Promise<IIdempotencyRecord | null> {
    const fullKey = this.buildKey(key);
    return this.store.get(fullKey);
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    return this.store.delete(fullKey);
  }

  private async waitForCompletion(key: string): Promise<IIdempotencyRecord> {
    const waitTimeout = this.config.waitTimeout ?? 60000;
    const startTime = Date.now();
    while (Date.now() - startTime < waitTimeout) {
      const record = await this.store.get(key);

      if (!record) {
        throw new IdempotencyRecordNotFoundError(key);
      }

      if (record.status === 'completed' || record.status === 'failed') {
        return record;
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new IdempotencyTimeoutError(key);
  }

  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? 'idempotency:';
    return `${prefix}${key}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
