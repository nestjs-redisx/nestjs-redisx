import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  STREAM_CONSUMER,
  IStreamConsumer,
  IStreamMessage,
  ConsumerHandle,
} from '@nestjs-redisx/streams';
import { Order, OrderService } from './types';

@Injectable()
export class OrderConsumer implements OnModuleInit, OnModuleDestroy {
  private handle: ConsumerHandle;

  constructor(
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
    private readonly orderService: OrderService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Create group if not exists
    await this.consumer.createGroup('orders', 'processors', '0');

    // Start consuming
    this.handle = this.consumer.consume<Order>(
      'orders',
      'processors',
      'worker-1',
      async (message) => {
        await this.processMessage(message);
      },
      {
        batchSize: 10,
        concurrency: 5,
      }
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.handle) {
      await this.consumer.stop(this.handle);
    }
  }

  private async processMessage(message: IStreamMessage<Order>): Promise<void> {
    try {
      await this.orderService.process(message.data);
      await message.ack();
    } catch (error) {
      await message.reject(error);
    }
  }
}
