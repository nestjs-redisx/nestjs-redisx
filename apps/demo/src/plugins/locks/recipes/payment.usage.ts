import { Injectable, ConflictException } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { Payment, OrderRepository, PaymentGateway } from '../types';

@Injectable()
export class PaymentService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly gateway: PaymentGateway,
  ) {}

  @WithLock({ key: 'payment:order:{0}', ttl: 30000 })
  async processPayment(orderId: string): Promise<Payment> {
    const order = await this.orders.findOne(orderId);

    if (order.status === 'paid') {
      throw new ConflictException('Already paid');
    }

    const payment = await this.gateway.charge(order.amount);
    await this.orders.update(orderId, { status: 'paid', paymentId: payment.id });

    return payment;
  }
}
