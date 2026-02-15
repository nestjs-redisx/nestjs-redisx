import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { User, UpdateUserDto, UserRepository } from '../types';

@Injectable()
export class UserService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: UserRepository,
  ) {}

  async getUser(id: string): Promise<User> {
    return this.cache.getOrSet(
      `user:${id}`,
      () => this.repository.findById(id),
      { ttl: 3600, tags: [`user:${id}`, 'users'] },
    );
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.repository.update(id, data);
    await this.cache.invalidateTags([`user:${id}`, 'users']);
    return user;
  }
}
