import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import * as promClient from 'prom-client';

@Injectable()
export class DLQMetrics {
  private readonly dlqCounter = new promClient.Counter({
    name: 'redisx_stream_dlq_total',
    help: 'Total messages moved to DLQ',
    labelNames: ['stream'],
  });

  private readonly dlqGauge = new promClient.Gauge({
    name: 'redisx_stream_dlq_size',
    help: 'Current DLQ size',
    labelNames: ['stream'],
  });

  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
  ) {}

  async trackDLQMove(stream: string): Promise<void> {
    this.dlqCounter.inc({ stream });
  }

  // @Cron('*/1 * * * *')  // Every minute
  async updateDLQSizes(): Promise<void> {
    const streams = ['orders', 'notifications', 'emails'];

    for (const stream of streams) {
      const info = await this.producer.getStreamInfo(`${stream}:dlq`);
      this.dlqGauge.set({ stream }, info.length);
    }
  }
}
