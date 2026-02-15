import { Injectable, Logger } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { Order } from './types';

@Injectable()
export class LoggingConsumer {
  private readonly logger = new Logger('StreamConsumer');

  @StreamConsumer({ stream: 'orders', group: 'processors' })
  async handle(message: IStreamMessage<Order>): Promise<void> {
    this.logger.log({
      event: 'message_received',
      stream: 'orders',
      group: 'processors',
      messageId: message.id,
      attempt: message.attempt,
      timestamp: message.timestamp,
    });

    try {
      await this.processOrder(message.data);
      await message.ack();

      this.logger.log({
        event: 'message_processed',
        messageId: message.id,
        duration: Date.now() - message.timestamp.getTime(),
      });
    } catch (error) {
      this.logger.error({
        event: 'message_failed',
        messageId: message.id,
        attempt: message.attempt,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      await message.reject(error as Error);
    }
  }

  private async processOrder(data: Order): Promise<void> {
    // Process the order
  }
}
