import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { Product, ProductServiceStub } from './types';

@Injectable()
export class CacheWarmupService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmupService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly products: ProductServiceStub,
  ) {}

  async onModuleInit() {
    const start = Date.now();

    await Promise.all([
      this.warmProducts(),
      this.warmConfig(),
    ]);

    this.logger.log(`Cache warmed in ${Date.now() - start}ms`);
  }

  private async warmProducts() {
    const products = await this.products.findTopSelling(100);

    for (const p of products) {
      await this.cache.getOrSet(
        `product:${p.id}`,
        () => Promise.resolve(p),
        { ttl: 3600, tags: ['products', `product:${p.id}`] },
      );
    }
  }

  private async warmConfig() {
    await this.cache.getOrSet(
      'config:app',
      () => this.loadConfig(),
      { ttl: 86400 },
    );
  }

  private async loadConfig() {
    return { key: 'app', value: {} };
  }
}
