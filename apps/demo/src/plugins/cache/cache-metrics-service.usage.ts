import { Injectable, OnModuleInit } from '@nestjs/common';
import { Gauge, register } from 'prom-client';
import { CacheService } from '@nestjs-redisx/cache';

@Injectable()
export class CacheMetricsService implements OnModuleInit {
  private readonly l1HitRate = new Gauge({
    name: 'cache_l1_hit_rate',
    help: 'L1 cache hit rate (0-1)',
  });

  private readonly l1Size = new Gauge({
    name: 'cache_l1_size',
    help: 'Current L1 cache size',
  });

  private readonly l2HitRate = new Gauge({
    name: 'cache_l2_hit_rate',
    help: 'L2 cache hit rate (0-1)',
  });

  private interval: NodeJS.Timeout;

  constructor(private readonly cache: CacheService) {}

  onModuleInit() {
    this.interval = setInterval(() => this.collect(), 10_000);
  }

  private async collect() {
    const stats = await this.cache.getStats();

    const l1Total = stats.l1.hits + stats.l1.misses;
    const l2Total = stats.l2.hits + stats.l2.misses;

    this.l1HitRate.set(l1Total > 0 ? stats.l1.hits / l1Total : 0);
    this.l1Size.set(stats.l1.size);
    this.l2HitRate.set(l2Total > 0 ? stats.l2.hits / l2Total : 0);
  }

  getMetrics() {
    return register.metrics();
  }
}
