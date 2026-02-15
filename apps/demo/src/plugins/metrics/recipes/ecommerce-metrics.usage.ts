import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { Order } from '../types';

@Injectable()
export class OrderMetrics implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.registerCounter(
      'orders_created_total',
      'Total orders created',
      ['status', 'payment_method', 'country'],
    );

    this.metrics.registerHistogram(
      'order_value_dollars',
      'Order value in dollars',
      [],
      [10, 50, 100, 500, 1000, 5000],
    );

    this.metrics.registerHistogram(
      'order_processing_duration_seconds',
      'Time to process order',
      ['step'],
      [0.1, 0.5, 1, 2, 5],
    );

    this.metrics.registerGauge(
      'inventory_level',
      'Current inventory level',
      ['product_id'],
    );
  }

  trackOrderCreated(order: Order): void {
    this.metrics.incrementCounter('orders_created_total', {
      status: order.status,
      payment_method: order.paymentMethod,
      country: order.shippingAddress.country,
    });

    this.metrics.observeHistogram('order_value_dollars', order.total);
  }

  trackInventoryChange(productId: string, newLevel: number): void {
    this.metrics.setGauge('inventory_level', newLevel, {
      product_id: productId,
    });
  }
}
