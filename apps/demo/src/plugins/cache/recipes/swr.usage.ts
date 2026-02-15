import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { Category, CatalogRepository } from '../types';

@Injectable()
export class CatalogService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: CatalogRepository,
  ) {}

  async getCategories(): Promise<Category[]> {
    return this.cache.getOrSet(
      'catalog:categories',
      () => this.repository.findAllCategories(),
      {
        ttl: 300,
        tags: ['catalog'],
        swr: { enabled: true, staleTime: 120 },
      },
    );
  }
}
