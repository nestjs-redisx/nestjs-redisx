import { Injectable, Inject } from '@nestjs/common';

import { COUNTERS_PLUGIN_OPTIONS, COUNTER_STORE, DEFAULT_COUNTERS_CONFIG } from '../../../shared/constants';
import { CounterValueError } from '../../../shared/errors';
import { ICountersPluginOptions, ICounterOptions } from '../../../shared/types';
import { validateCounterKey, validateCounterAmount, validateCounterValue, validateCounterTtl, validateCountersOptions } from '../../../shared/utils/validate-counter-options';
import { ICounterService } from '../ports/counter-service.port';
import { ICounterStore } from '../ports/counter-store.port';

/**
 * Counter service implementation.
 *
 * Thin, strict, atomic: every mutation is a single Redis operation, every
 * input is validated fail-fast, and non-numeric values fail loudly instead
 * of silently producing NaN.
 */
@Injectable()
export class CounterService implements ICounterService {
  constructor(
    @Inject(COUNTERS_PLUGIN_OPTIONS) private readonly config: ICountersPluginOptions,
    @Inject(COUNTER_STORE) private readonly store: ICounterStore,
  ) {
    // The service is exported for direct wiring too - validate here as well
    // as in the plugin, so a hand-constructed service fails fast.
    validateCountersOptions(config, 'CounterService');
  }

  async increment(key: string, by = 1, options: ICounterOptions = {}): Promise<number> {
    validateCounterKey(key, 'increment');
    validateCounterAmount(by, 'increment');
    validateCounterTtl(options.ttl, 'increment');
    return this.store.incrementBy(this.buildKey(key), by, options.ttl);
  }

  async decrement(key: string, by = 1, options: ICounterOptions = {}): Promise<number> {
    validateCounterKey(key, 'decrement');
    validateCounterAmount(by, 'decrement');
    validateCounterTtl(options.ttl, 'decrement');
    return this.store.incrementBy(this.buildKey(key), -by, options.ttl);
  }

  async get(key: string): Promise<number> {
    validateCounterKey(key, 'get');
    return this.readNumeric(key);
  }

  async set(key: string, value: number, options: ICounterOptions = {}): Promise<void> {
    validateCounterKey(key, 'set');
    validateCounterValue(value, 'set');
    validateCounterTtl(options.ttl, 'set');
    await this.store.set(this.buildKey(key), value, options.ttl);
  }

  async reset(key: string): Promise<boolean> {
    validateCounterKey(key, 'reset');
    return this.store.reset(this.buildKey(key));
  }

  async getAndReset(key: string): Promise<number> {
    validateCounterKey(key, 'getAndReset');
    const value = await this.store.getAndReset(this.buildKey(key));
    if (!Number.isSafeInteger(value)) {
      // Backstop for custom stores - the Redis adapter already throws with
      // the actual raw value.
      throw new CounterValueError(key, String(value));
    }
    return value;
  }

  async next(sequence: string): Promise<number> {
    validateCounterKey(sequence, 'next');
    // No TTL - sequences are permanent by definition.
    return this.store.incrementBy(this.buildKey(sequence), 1);
  }

  async current(sequence: string): Promise<number> {
    validateCounterKey(sequence, 'current');
    return this.readNumeric(sequence);
  }

  /**
   * Reads a counter as a number; 0 when absent, loud when non-numeric -
   * silently returning NaN would poison every downstream aggregate.
   */
  private async readNumeric(key: string): Promise<number> {
    const value = await this.store.get(this.buildKey(key));
    if (value === null) {
      return 0;
    }
    if (!Number.isSafeInteger(value)) {
      // Backstop for custom stores - the Redis adapter already throws with
      // the actual raw value.
      throw new CounterValueError(key, String(value));
    }
    return value;
  }

  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? DEFAULT_COUNTERS_CONFIG.keyPrefix;
    return `${prefix}${key}`;
  }
}
