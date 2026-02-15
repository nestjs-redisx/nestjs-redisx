import { Injectable, Inject } from '@nestjs/common';
import {
  DEAD_LETTER_SERVICE,
  IDeadLetterService,
  STREAM_PRODUCER,
  IStreamProducer,
} from '@nestjs-redisx/streams';
import { Order } from './types';

@Injectable()
export class DLQProcessor {
  constructor(
    @Inject(DEAD_LETTER_SERVICE) private readonly dlq: IDeadLetterService,
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
  ) {}

  async processFailedOrders(): Promise<void> {
    const messages = await this.dlq.getMessages<Order>('orders', 50);

    for (const msg of messages) {
      if (msg.error.includes('timeout')) {
        // Use backup payment processor
        await this.processWithBackup(msg.data);
      } else if (msg.error.includes('validation')) {
        // Fix validation and reprocess
        const fixed = await this.fixValidation(msg.data);
        await this.producer.publish(msg.originalStream, fixed);
      }
    }
  }

  private async processWithBackup(data: Order): Promise<void> {
    // Backup processing logic
  }

  private async fixValidation(data: Order): Promise<Order> {
    // Fix validation issues and return corrected data
    return data;
  }
}
