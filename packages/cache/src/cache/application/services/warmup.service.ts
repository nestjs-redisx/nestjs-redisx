/**
 * Cache warmup service.
 * Loads specified keys into cache on application startup.
 */

import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';

import { CACHE_SERVICE, CACHE_PLUGIN_OPTIONS } from '../../../shared/constants';
import { ICachePluginOptions, IWarmupKey } from '../../../shared/types';
import { ICacheService } from '../ports/cache-service.port';

@Injectable()
export class WarmupService implements OnModuleInit {
  private readonly logger = new Logger(WarmupService.name);
  private readonly enabled: boolean;
  private readonly keys: IWarmupKey[];
  private readonly concurrency: number;

  constructor(
    @Inject(CACHE_SERVICE) private readonly cacheService: ICacheService,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly options: ICachePluginOptions,
  ) {
    this.enabled = options.warmup?.enabled ?? false;
    this.keys = options.warmup?.keys ?? [];
    this.concurrency = options.warmup?.concurrency ?? 10;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || this.keys.length === 0) {
      return;
    }

    this.logger.log(`Starting cache warmup for ${this.keys.length} keys...`);

    const startTime = Date.now();

    // Simple concurrency control: split into chunks
    const chunks: IWarmupKey[][] = [];
    for (let i = 0; i < this.keys.length; i += this.concurrency) {
      chunks.push(this.keys.slice(i, i + this.concurrency));
    }

    let succeeded = 0;
    let failed = 0;

    for (const chunk of chunks) {
      const results = await Promise.allSettled(chunk.map((warmupKey) => this.warmupKey(warmupKey)));

      succeeded += results.filter((r) => r.status === 'fulfilled').length;
      failed += results.filter((r) => r.status === 'rejected').length;
    }

    const duration = Date.now() - startTime;

    this.logger.log(`Cache warmup completed: ${succeeded} succeeded, ${failed} failed (${duration}ms)`);
  }

  /**
   * Warms up a single cache key.
   *
   * @param warmupKey - Warmup key configuration
   * @private
   */
  private async warmupKey(warmupKey: IWarmupKey): Promise<void> {
    try {
      this.logger.debug(`Warming up key: ${warmupKey.key}`);

      await this.cacheService.getOrSet(warmupKey.key, warmupKey.loader, {
        ttl: warmupKey.ttl,
        tags: warmupKey.tags,
      });

      this.logger.debug(`Successfully warmed up key: ${warmupKey.key}`);
    } catch (error) {
      this.logger.error(`Failed to warm up key ${warmupKey.key}:`, error);
      throw error;
    }
  }
}
