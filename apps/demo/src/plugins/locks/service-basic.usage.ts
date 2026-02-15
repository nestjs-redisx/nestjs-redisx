import { Injectable, Inject } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';
import { InventoryStore } from './types';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
    private readonly inventory: InventoryStore,
  ) {}

  async reserveItem(itemId: string, quantity: number): Promise<boolean> {
    return this.lockService.withLock(
      `inventory:${itemId}`,
      async () => {
        const stock = await this.inventory.getStock(itemId);

        if (stock < quantity) {
          return false;
        }

        await this.inventory.decrement(itemId, quantity);
        return true;
      },
      { ttl: 5000 },
    );
  }
}
