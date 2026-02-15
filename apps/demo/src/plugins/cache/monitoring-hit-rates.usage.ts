import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';

@Injectable()
export class MonitoringService {
  constructor(private readonly cache: CacheService) {}

  async getCacheMetrics() {
    const stats = await this.cache.getStats();

    const l1Total = stats.l1.hits + stats.l1.misses;
    const l2Total = stats.l2.hits + stats.l2.misses;

    return {
      l1: {
        size: stats.l1.size,
        hitRate: l1Total > 0 ? (stats.l1.hits / l1Total * 100).toFixed(2) + '%' : 'N/A',
        hits: stats.l1.hits,
        misses: stats.l1.misses,
      },
      l2: {
        hitRate: l2Total > 0 ? (stats.l2.hits / l2Total * 100).toFixed(2) + '%' : 'N/A',
        hits: stats.l2.hits,
        misses: stats.l2.misses,
      },
      stampedePrevented: stats.stampedePrevented,
    };
  }
}
