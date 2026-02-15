import { Injectable } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import * as promClient from 'prom-client';
import { Order } from './types';

@Injectable()
export class MonitoredConsumer {
  private processedCounter = new promClient.Counter({
    name: 'stream_messages_processed_total',
    help: 'Total messages processed',
    labelNames: ['stream', 'status'],
  });

  private processingDuration = new promClient.Histogram({
    name: 'stream_message_processing_duration_seconds',
    help: 'Message processing duration',
    labelNames: ['stream'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  });

  @StreamConsumer({
    stream: 'orders',
    group: 'processors',
    batchSize: 10,
    concurrency: 5,
  })
  async handle(message: IStreamMessage<Order>): Promise<void> {
    const timer = this.processingDuration.startTimer({ stream: 'orders' });

    try {
      await this.processOrder(message.data);
      await message.ack();

      this.processedCounter.inc({ stream: 'orders', status: 'success' });
    } catch (error) {
      await message.reject(error);
      this.processedCounter.inc({ stream: 'orders', status: 'error' });
    } finally {
      timer();
    }
  }

  private async processOrder(data: Order): Promise<void> {
    // Process the order
  }
}
