import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import {
  CreateOrderDto,
  Order,
  OrderRepository,
  OutboxRepo,
  DatabaseTransaction,
} from './types';

@Injectable()
export class OutboxService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly orderRepo: OrderRepository,
    private readonly outboxRepo: OutboxRepo,
    private readonly db: DatabaseTransaction,
  ) {}

  async createOrderWithEvents(dto: CreateOrderDto): Promise<Order> {
    return await this.db.transaction(async (tx) => {
      // 1. Create order in database
      const order = await this.orderRepo.create(dto, { transaction: tx });

      // 2. Write event to outbox table
      await this.outboxRepo.create({
        aggregateId: order.id,
        eventType: 'ORDER_CREATED',
        payload: order,
        createdAt: new Date(),
      }, { transaction: tx });

      return order;
    });
  }

  // Background job to publish outbox events
  // @Cron('*/5 * * * * *')  // Every 5 seconds
  async publishOutboxEvents(): Promise<void> {
    const events = await this.outboxRepo.findUnpublished();

    for (const event of events) {
      try {
        // Publish to stream
        await this.producer.publish('orders', {
          type: event.eventType,
          data: event.payload,
        });

        // Mark as published
        await this.outboxRepo.markPublished(event.id);
      } catch (error) {
        console.error('Failed to publish outbox event', error);
      }
    }
  }
}
