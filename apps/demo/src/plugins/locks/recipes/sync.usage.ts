import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { ExternalApiClient, Database } from '../types';

@Injectable()
export class SyncService {
  constructor(
    private readonly externalApi: ExternalApiClient,
    private readonly db: Database,
  ) {}

  @WithLock({
    key: 'sync:products',
    ttl: 300000, // 5 min
    autoRenew: true,
  })
  async syncProducts(): Promise<void> {
    // Only one instance syncs at a time
    const products = await this.externalApi.fetchProducts();
    await this.db.bulkUpsert(products);
  }
}
