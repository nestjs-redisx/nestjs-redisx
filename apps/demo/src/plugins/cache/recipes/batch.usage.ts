import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { Product, ProductRepository } from '../types';

@Injectable()
export class ProductService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: ProductRepository,
  ) {}

  async getByIds(ids: string[]): Promise<Map<string, Product>> {
    const keys = ids.map(id => `product:${id}`);
    const cached = await this.cache.getMany<Product>(keys);  // Array<Product | null>

    // Collect results and find missing IDs
    const results = new Map<string, Product>();
    const missingIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      if (cached[i] !== null) {
        results.set(ids[i], cached[i]!);
      } else {
        missingIds.push(ids[i]);
      }
    }

    // Load missing from DB and backfill cache
    if (missingIds.length > 0) {
      const loaded = await this.repository.findByIds(missingIds);

      await this.cache.setMany(
        loaded.map(p => ({ key: `product:${p.id}`, value: p, ttl: 3600 })),
      );

      for (const product of loaded) {
        results.set(product.id, product);
      }
    }

    return results;
  }
}
