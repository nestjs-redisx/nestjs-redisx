import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { CreateOrderDto, Order, OrderRepository } from './types';

@Injectable()
export class OrderService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly orderRepository: OrderRepository,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.orderRepository.create(dto);

    await this.producer.publish('orders', {
      type: 'ORDER_CREATED',
      orderId: order.id,
      customerId: order.customerId,
      total: order.total,
    });

    return order;
  }
}
