import { Injectable } from '@nestjs/common';
import { Cached } from '@nestjs-redisx/cache';
import { Order, OrderRepository } from '../types';

@Injectable()
export class OrderService {
  constructor(private readonly repository: OrderRepository) {}

  @Cached({
    key: 'order:{0}',
    ttl: 300,
    tags: (id: string) => [`order:${id}`],
    // Don't cache if caller requests fresh data
    condition: (id: string, options?: { fresh?: boolean }) => !options?.fresh,
    // Don't cache empty results
    unless: (result: Order | null) => result === null,
  })
  async findById(id: string, options?: { fresh?: boolean }): Promise<Order | null> {
    return this.repository.findById(id);
  }
}
