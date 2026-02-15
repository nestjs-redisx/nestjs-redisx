import { Injectable } from '@nestjs/common';
import { InvalidateOn } from '@nestjs-redisx/cache';
import { User, UpdateDto, UserRepository } from '../types';

@Injectable()
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  // Local invalidation only
  @InvalidateOn({
    events: ['user.updated'],
    tags: (result: any, [userId]: any[]) => [`user:${userId}`, 'users'],
  })
  async updateUser(userId: string, data: UpdateDto): Promise<User> {
    return this.repository.update(userId, data);
  }

  // Local + distributed invalidation
  @InvalidateOn({
    events: ['user.deleted'],
    keys: (result: any, [userId]: any[]) => [`user:${userId}`],
    tags: ['users'],
    publish: true,  // Other nodes will also invalidate these tags/keys
  })
  async deleteUser(userId: string): Promise<void> {
    await this.repository.delete(userId);
  }
}
