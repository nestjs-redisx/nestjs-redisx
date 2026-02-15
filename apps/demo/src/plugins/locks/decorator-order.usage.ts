import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { Order } from './types';

@Injectable()
export class OrderService {
  @WithLock({ key: 'order:{0}', ttl: 10000 })
  async processOrder(orderId: string): Promise<Order> {
    // This method is protected by a distributed lock
    // Only one instance can process this orderId at a time
    return this.doProcess(orderId);
  }

  private async doProcess(orderId: string): Promise<Order> {
    return { id: orderId, amount: 0, status: 'processed' };
  }
}
