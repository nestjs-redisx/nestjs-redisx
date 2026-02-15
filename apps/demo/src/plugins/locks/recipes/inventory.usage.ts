import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { InventoryStore } from '../types';

@Injectable()
export class InventoryService {
  constructor(private readonly inventory: InventoryStore) {}

  @WithLock({ key: 'inventory:{0}', ttl: 5000 })
  async reserveStock(sku: string, quantity: number): Promise<boolean> {
    const current = await this.inventory.getStock(sku);

    if (current < quantity) {
      return false;
    }

    await this.inventory.decrement(sku, quantity);
    return true;
  }
}
