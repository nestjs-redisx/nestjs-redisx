import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { PeriodStats, OrderRepository } from '../types';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly cache: CacheService,
    private readonly orderRepository: OrderRepository,
  ) {}

  async getStats(period: string): Promise<PeriodStats> {
    return this.cache.getOrSet(
      `analytics:${period}`,
      async () => {
        const orders = await this.orderRepository.findByPeriod(period);
        const revenue = orders.reduce((sum, o) => sum + o.total, 0);

        return {
          totalOrders: orders.length,
          totalRevenue: revenue,
          avgOrderValue: orders.length > 0 ? revenue / orders.length : 0,
        };
      },
      { ttl: 3600, tags: ['analytics'] },
    );
  }

  async onOrderCreated(): Promise<void> {
    await this.cache.invalidateTags(['analytics']);
  }
}
