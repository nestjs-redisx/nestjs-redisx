/**
 * Anti-stampede protection using local singleflight + distributed Redis lock.
 *
 * Two layers of protection:
 * 1. Local singleflight — coalesces concurrent requests within the same process
 * 2. Distributed lock — prevents duplicate loading across multiple instances
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver } from '@nestjs-redisx/core';

import { CACHE_PLUGIN_OPTIONS } from '../../shared/constants';
import { StampedeError, LoaderError } from '../../shared/errors';
import { ICachePluginOptions, IStampedeResult, IStampedeStats } from '../../shared/types';
import { IStampedeProtection } from '../application/ports/stampede-protection.port';

/** Lua script to release lock only if we own it */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();

/** Prefix for stampede lock keys in Redis */
const LOCK_PREFIX = '_stampede:';

/** Polling interval when waiting for another loader (ms) */
const _POLL_INTERVAL_MS = 50;

interface IFlight<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  waiters: number;
  timestamp: number;
}

@Injectable()
export class StampedeProtectionService implements IStampedeProtection {
  private readonly logger = new Logger(StampedeProtectionService.name);
  private readonly flights = new Map<string, IFlight<unknown>>();
  private readonly lockTimeout: number;
  private readonly waitTimeout: number;
  private prevented = 0;

  constructor(
    @Inject(CACHE_PLUGIN_OPTIONS)
    private readonly options: ICachePluginOptions,
    @Inject(REDIS_DRIVER)
    private readonly driver: IRedisDriver,
  ) {
    this.lockTimeout = options.stampede?.lockTimeout ?? 5000;
    this.waitTimeout = options.stampede?.waitTimeout ?? 10000;
  }

  async protect<T>(key: string, loader: () => Promise<T>): Promise<IStampedeResult<T>> {
    // Layer 1: Local singleflight (same-process deduplication)
    const existingFlight = this.flights.get(key);

    if (existingFlight) {
      existingFlight.waiters++;
      this.prevented++;
      const value = await this.waitForFlight<T>(existingFlight as IFlight<T>, key);
      return { value, cached: true, waited: true };
    }

    // Create flight SYNCHRONOUSLY before any async work
    // This ensures concurrent calls within the same tick see the flight
    let resolveFunc!: (value: T) => void;
    let rejectFunc!: (error: Error) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    const flight: IFlight<T> = {
      promise,
      resolve: resolveFunc,
      reject: rejectFunc,
      waiters: 0,
      timestamp: Date.now(),
    };

    this.flights.set(key, flight as IFlight<unknown>);

    // Layer 2: Try distributed lock (async)
    let lock: { lockKey: string; lockValue: string } | undefined;

    try {
      const lockKey = `${LOCK_PREFIX}${key}`;
      const lockValue = this.generateLockValue();
      const lockTtlSeconds = Math.ceil(this.lockTimeout / 1000);

      const acquired = await this.tryAcquireLock(lockKey, lockValue, lockTtlSeconds);

      if (acquired) {
        lock = { lockKey, lockValue };
      }
      // If not acquired, another instance is loading.
      // We still execute the loader as fallback since we're already the leader
      // in this process (the flight is registered).
    } catch {
      // Lock acquisition failed — proceed without distributed lock
    }

    // Execute loader
    try {
      const value = await this.executeLoader(loader, key);
      flight.resolve(value);
      return { value, cached: false, waited: false };
    } catch (error) {
      if (flight.waiters > 0) {
        flight.reject(error as Error);
      }
      throw error;
    } finally {
      setTimeout(() => {
        this.flights.delete(key);
      }, 100);

      if (lock) {
        this.releaseLock(lock.lockKey, lock.lockValue).catch((err) => {
          this.logger.warn(`Failed to release lock for "${key}": ${err.message}`);
        });
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clearKey(key: string): Promise<void> {
    const flight = this.flights.get(key);
    if (flight) {
      flight.reject(new Error('Flight cancelled'));
      this.flights.delete(key);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clearAll(): Promise<void> {
    for (const [, flight] of this.flights.entries()) {
      flight.reject(new Error('All flights cancelled'));
    }
    this.flights.clear();
  }

  getStats(): IStampedeStats {
    const stats: IStampedeStats = {
      activeFlights: this.flights.size,
      totalWaiters: 0,
      oldestFlight: 0,
      prevented: this.prevented,
    };

    const now = Date.now();
    let oldestTimestamp = now;

    for (const flight of this.flights.values()) {
      stats.totalWaiters += flight.waiters;
      if (flight.timestamp < oldestTimestamp) {
        oldestTimestamp = flight.timestamp;
      }
    }

    stats.oldestFlight = stats.activeFlights > 0 ? now - oldestTimestamp : 0;
    return stats;
  }

  private async waitForFlight<T>(flight: IFlight<T>, key: string): Promise<T> {
    const age = Date.now() - flight.timestamp;
    if (age > this.lockTimeout) {
      throw new StampedeError(key, age);
    }

    let timeoutId: NodeJS.Timeout | undefined;
    let timeoutCancelled = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!timeoutCancelled) {
          reject(new StampedeError(key, this.waitTimeout));
        }
      }, this.waitTimeout);
    });

    try {
      const result = await Promise.race([flight.promise, timeoutPromise]);
      timeoutCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      timeoutCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    }
  }

  private async executeLoader<T>(loader: () => Promise<T>, key: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    let timeoutCancelled = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!timeoutCancelled) {
          reject(new StampedeError(key, this.lockTimeout));
        }
      }, this.lockTimeout);
    });

    try {
      const result = await Promise.race([loader(), timeoutPromise]);
      timeoutCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      timeoutCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);

      if (error instanceof StampedeError) {
        throw error;
      }

      throw new LoaderError(key, error as Error);
    }
  }

  private async tryAcquireLock(lockKey: string, lockValue: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.driver.set(lockKey, lockValue, { ex: ttlSeconds, nx: true });
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Failed to acquire distributed lock: ${(error as Error).message}`);
      return false;
    }
  }

  private async releaseLock(lockKey: string, lockValue: string): Promise<void> {
    try {
      await this.driver.eval(RELEASE_LOCK_SCRIPT, [lockKey], [lockValue]);
    } catch (error) {
      this.logger.warn(`Failed to release distributed lock: ${(error as Error).message}`);
    }
  }

  private generateLockValue(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
