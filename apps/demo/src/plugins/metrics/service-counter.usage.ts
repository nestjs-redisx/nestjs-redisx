import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { CreateOrderDto, Order, OrderRepo } from './types';

@Injectable()
export class OrderService implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
    private readonly orderRepo: OrderRepo,
  ) {}

  onModuleInit(): void {
    this.metrics.registerCounter(
      'orders_created_total',
      'Total orders created',
      ['status', 'payment_method'],
    );
  }

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.orderRepo.create(dto);

    // Increment counter
    this.metrics.incrementCounter('orders_created_total', {
      status: order.status,
      payment_method: order.paymentMethod,
    });

    return order;
  }
}
