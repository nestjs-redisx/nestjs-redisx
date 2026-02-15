import { Injectable } from '@nestjs/common';
import { Cached, InvalidateTags } from '@nestjs-redisx/cache';
import { Product, UpdateProductDto, ProductRepository } from '../types';

@Injectable()
export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  @Cached({
    key: 'product:{0}',
    ttl: 600,
    tags: (id: string) => [`product:${id}`, 'products'],
  })
  async findById(id: string): Promise<Product> {
    return this.repository.findById(id);
  }

  @InvalidateTags({
    tags: (id: string) => [`product:${id}`, 'products'],
  })
  async update(id: string, data: UpdateProductDto): Promise<Product> {
    return this.repository.update(id, data);
  }
}
