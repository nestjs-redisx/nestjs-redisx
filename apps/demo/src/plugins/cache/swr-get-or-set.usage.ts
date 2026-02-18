import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { User, UserRepository } from './types';

// SWR with getOrSet (Service API approach)
@Injectable()
export class UserService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: UserRepository,
  ) {}

  async getUser(id: string): Promise<User> {
    return this.cache.getOrSet<User>(
      `user:${id}`,
      () => this.repository.findOne(id),
      {
        ttl: 300,
        tags: ['users'],
        swr: { enabled: true, staleTime: 300 },
      }
    );
  }
}
