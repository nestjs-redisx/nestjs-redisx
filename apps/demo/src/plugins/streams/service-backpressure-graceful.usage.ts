import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { Order } from './types';

@Injectable()
export class GracefulConsumer implements OnModuleDestroy {
  private isShuttingDown = false;

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    // Wait for in-flight messages
    await this.waitForInflight();
  }

  @StreamConsumer({ stream: 'orders', group: 'processors' })
  async handle(message: IStreamMessage<Order>): Promise<void> {
    if (this.isShuttingDown) {
      // Don't process new messages during shutdown
      await message.reject(new Error('Shutting down'));
      return;
    }

    await this.processOrder(message.data);
    await message.ack();
  }

  private async processOrder(data: Order): Promise<void> {
    // Process the order
  }

  private async waitForInflight(): Promise<void> {
    // Wait for in-flight message processing to complete
  }
}
