import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { Payment, PaymentAlreadyProcessedError, OrderRepository, PaymentGateway } from './types';

@Injectable()
export class PaymentService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  @WithLock({
    key: 'payment:{0}',
    ttl: 10000,
  })
  async processPayment(orderId: string): Promise<Payment> {
    // Only one instance can process this order at a time
    const order = await this.orderRepository.findById(orderId);

    if (order.status === 'paid') {
      throw new PaymentAlreadyProcessedError(orderId);
    }

    const result = await this.paymentGateway.charge(order);
    await this.orderRepository.update(orderId, { status: 'paid' });

    return result;
  }
}
