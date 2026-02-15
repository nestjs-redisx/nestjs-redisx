import { Injectable } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { StreamMetrics } from './monitoring-metrics.usage';
import { Order } from './types';

@Injectable()
export class InstrumentedConsumer {
  constructor(private readonly metrics: StreamMetrics) {}

  @StreamConsumer({ stream: 'orders', group: 'processors' })
  async handle(message: IStreamMessage<Order>): Promise<void> {
    const timer = this.metrics.processingDuration.startTimer({
      stream: 'orders',
      group: 'processors',
    });

    try {
      await this.processOrder(message.data);
      await message.ack();

      this.metrics.messagesProcessed.inc({
        stream: 'orders',
        group: 'processors',
        status: 'success',
      });
    } catch (error) {
      await message.reject(error);

      this.metrics.messagesProcessed.inc({
        stream: 'orders',
        group: 'processors',
        status: 'error',
      });
    } finally {
      timer();
    }
  }

  private async processOrder(data: Order): Promise<void> {
    // Process the order
  }
}
