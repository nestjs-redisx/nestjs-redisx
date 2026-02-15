/**
 * Stale-While-Revalidate manager.
 * Serves stale data while revalidating in the background.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';

import { CACHE_PLUGIN_OPTIONS } from '../../shared/constants';
import { ICachePluginOptions, SwrEntry } from '../../shared/types';
import { ISwrManager } from '../application/ports/swr-manager.port';

interface IRevalidationJob<T> {
  key: string;
  loader: () => Promise<T>;
  onSuccess: (value: T) => Promise<void>;
  onError: (error: Error) => void;
  timestamp: number;
}

@Injectable()
export class SwrManagerService implements ISwrManager {
  private readonly logger = new Logger(SwrManagerService.name);
  private readonly jobs = new Map<string, IRevalidationJob<unknown>>();
  private readonly staleTtl: number;
  private readonly enabled: boolean;

  constructor(
    @Inject(CACHE_PLUGIN_OPTIONS)
    private readonly options: ICachePluginOptions,
  ) {
    this.enabled = options.swr?.enabled ?? false;
    this.staleTtl = options.swr?.defaultStaleTime ?? 60;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get<T>(_key: string): Promise<SwrEntry<T> | null> {
    // SWR entries are stored in L2 cache via getSwr/setSwr.
    // This method is not used directly; CacheService accesses L2 store.
    return null;
  }

  async set<T>(_key: string, _value: T, _staleTimeSeconds: number): Promise<void> {
    // SWR entries are stored in L2 cache via getSwr/setSwr.
  }

  async delete(_key: string): Promise<void> {
    // SWR entries are deleted from L2 cache directly.
  }

  isStale<T>(entry: SwrEntry<T>): boolean {
    if (!this.enabled) {
      return false;
    }

    const now = Date.now();
    return now > entry.staleAt;
  }

  isExpired<T>(entry: SwrEntry<T>): boolean {
    const now = Date.now();
    return now > entry.expiresAt;
  }

  shouldRevalidate(key: string): boolean {
    // Don't revalidate if job already running
    return !this.jobs.has(key);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async scheduleRevalidation<T>(key: string, loader: () => Promise<T>, onSuccess: (value: T) => Promise<void>, onError?: (error: Error) => void): Promise<void> {
    // Check if already scheduled
    if (this.jobs.has(key)) {
      this.logger.debug(`Revalidation already scheduled for key: ${key}`);
      return;
    }

    const job: IRevalidationJob<T> = {
      key,
      loader,
      onSuccess,
      onError: onError ?? ((error) => this.logger.error(`Revalidation failed for ${key}:`, error)),
      timestamp: Date.now(),
    };

    this.jobs.set(key, job as IRevalidationJob<unknown>);

    // Execute in background
    setImmediate(() => {
      void this.executeRevalidation(job);
    });
  }

  createSwrEntry<T>(value: T, freshTtl: number, staleTtl?: number): SwrEntry<T> {
    const now = Date.now();
    const freshTtlMs = freshTtl * 1000;
    const staleTtlMs = (staleTtl ?? this.staleTtl) * 1000;

    return {
      value,
      cachedAt: now,
      staleAt: now + freshTtlMs,
      expiresAt: now + freshTtlMs + staleTtlMs,
    };
  }

  getStats() {
    return {
      activeRevalidations: this.jobs.size,
      enabled: this.enabled,
      staleTtl: this.staleTtl,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clearRevalidations(): Promise<void> {
    this.jobs.clear();
  }

  private async executeRevalidation<T>(job: IRevalidationJob<T>): Promise<void> {
    try {
      this.logger.debug(`Starting revalidation for key: ${job.key}`);

      const value = await job.loader();

      this.logger.debug(`Revalidation successful for key: ${job.key}`);

      await job.onSuccess(value);
    } catch (error) {
      this.logger.error(`Revalidation failed for key: ${job.key}`, error);
      job.onError(error as Error);
    } finally {
      this.jobs.delete(job.key);
    }
  }
}
