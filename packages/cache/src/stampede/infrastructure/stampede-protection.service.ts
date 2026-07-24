/**
 * Anti-stampede protection using local singleflight + distributed Redis lock.
 *
 * Two layers of protection:
 * 1. Local singleflight — coalesces concurrent requests within the same
 *    process; the flight is removed synchronously on completion so a finished
 *    flight can never serve stale (pre-invalidation) values to later calls.
 * 2. Distributed lock — the first instance to acquire the lock loads and
 *    writes the value (the caller's loader performs the cache write, so the
 *    write is covered by the lock); other instances wait for the lock to
 *    clear and recheck the cache instead of duplicating the load, falling
 *    back to their own loader if coordination falls through.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { CACHE_REDIS_DRIVER, CACHE_PLUGIN_OPTIONS } from '../../shared/constants';
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

/** Polling interval while waiting for another instance's lock to clear (ms) */
const POLL_INTERVAL_MS = 50;

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
    @Inject(CACHE_REDIS_DRIVER)
    private readonly driver: IRedisDriver,
  ) {
    this.lockTimeout = options.stampede?.lockTimeout ?? 5000;
    this.waitTimeout = options.stampede?.waitTimeout ?? 10000;
  }

  async protect<T>(key: string, loader: () => Promise<T>, recheck?: () => Promise<T | null>): Promise<IStampedeResult<T>> {
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

    const lockKey = `${LOCK_PREFIX}${key}`;
    let lock: { lockKey: string; lockValue: string } | undefined;

    try {
      // Layer 2: Try distributed lock (cross-instance coordination)
      try {
        const lockValue = this.generateLockValue();
        const lockTtlSeconds = Math.ceil(this.lockTimeout / 1000);

        const acquired = await this.tryAcquireLock(lockKey, lockValue, lockTtlSeconds);

        if (acquired) {
          lock = { lockKey, lockValue };
        }
      } catch {
        // Lock acquisition failed — proceed without distributed lock
      }

      // Lock held by ANOTHER instance: wait for it to finish (the lock is
      // released only after the leader wrote the value to the cache), then
      // recheck the cache instead of duplicating the load. Falls through to
      // our own loader if the leader failed, its lock expired, or the wait
      // timed out — availability over strict coordination.
      if (!lock && recheck) {
        const shared = await this.waitForDistributedLoad(lockKey, recheck, key);
        if (shared !== null) {
          this.prevented++;
          flight.resolve(shared);
          return { value: shared, cached: true, waited: true };
        }
      }

      // Execute loader (we are the leader, or coordination fell through)
      try {
        const value = await this.executeLoader(loader, key);
        flight.resolve(value);
        return { value, cached: false, waited: false };
      } catch (error) {
        if (flight.waiters > 0) {
          flight.reject(error as Error);
        }
        throw error;
      }
    } finally {
      // Delete the flight SYNCHRONOUSLY. Waiters that joined during the load
      // already hold the promise reference, so a delayed cleanup buys nothing —
      // but a lingering resolved flight would serve stale (pre-invalidation)
      // values to later calls (mutation -> invalidateTags -> instant refetch),
      // and a lingering rejected-with-no-waiters flight would hang new callers
      // until waitTimeout.
      this.flights.delete(key);

      if (lock) {
        this.releaseLock(lock.lockKey, lock.lockValue).catch((err) => {
          this.logger.warn(`Failed to release lock for "${key}": ${err.message}`);
        });
      }
    }
  }

  /**
   * Waits (bounded by waitTimeout) for another instance's stampede lock to
   * clear, then rechecks the cache via the provided callback.
   *
   * @returns The value the other instance cached, or null when coordination
   *          fell through (lock still held at timeout, leader cached nothing,
   *          or the recheck itself failed).
   */
  private async waitForDistributedLoad<T>(lockKey: string, recheck: () => Promise<T | null>, key: string): Promise<T | null> {
    const deadline = Date.now() + this.waitTimeout;

    try {
      while (Date.now() < deadline) {
        const held = await this.driver.exists(lockKey);
        if (!held) {
          return (await recheck()) ?? null;
        }
        const remaining = deadline - Date.now();
        await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(remaining, 0))));
      }
    } catch (error) {
      this.logger.warn(`Cross-instance wait failed for "${key}": ${(error as Error).message}`);
    }

    return null;
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
