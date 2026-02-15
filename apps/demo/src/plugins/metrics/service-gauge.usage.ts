import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { RedisClient } from './types';

@Injectable()
export class QueueService implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
    private readonly redis: RedisClient,
  ) {}

  onModuleInit(): void {
    this.metrics.registerGauge(
      'queue_size',
      'Current queue size',
      ['queue'],
    );

    // Update periodically
    setInterval(() => this.updateQueueSize(), 15000);
  }

  private async updateQueueSize(): Promise<void> {
    const size = await this.redis.llen('queue:orders');
    this.metrics.setGauge('queue_size', size, { queue: 'orders' });
  }
}
