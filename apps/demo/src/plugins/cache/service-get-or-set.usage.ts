import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { UserRepository } from './types';

@Injectable()
export class UserService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: UserRepository,
  ) {}

  getById = this.cache.wrap(
    async (id: string) => this.repository.findById(id),
    {
      key: (id: string) => `user:${id}`,       // Key builder (required, function)
      ttl: 3600,                                // TTL in seconds
      tags: (id: string) => [`user:${id}`, 'users'],  // Static array or function
    }
  );
}
