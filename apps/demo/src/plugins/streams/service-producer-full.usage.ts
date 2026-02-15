import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { CreateOrderDto, Order, OrderStats, OrderRepository } from './types';

@Injectable()
export class OrderService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly orderRepo: OrderRepository,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // 1. Save to database
    const order = await this.orderRepo.create(dto);

    // 2. Publish event
    try {
      await this.producer.publish('orders', {
        type: 'ORDER_CREATED',
        orderId: order.id,
        customerId: order.customerId,
        items: order.items,
        total: order.total,
        createdAt: order.createdAt,
      }, {
        maxLen: 100000,
      });
    } catch (error) {
      // Log but don't fail order creation
      console.error('Failed to publish order event:', error);
    }

    return order;
  }

  async getOrderStats(): Promise<OrderStats> {
    const info = await this.producer.getStreamInfo('orders');

    return {
      totalEvents: info.length,
      oldestEvent: info.firstEntry?.timestamp,
      newestEvent: info.lastEntry?.timestamp,
    };
  }
}
