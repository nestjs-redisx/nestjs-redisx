import { Injectable } from '@nestjs/common';
import { Cached, InvalidateTags, InvalidateOn } from '@nestjs-redisx/cache';
import { User, UpdateDto, UserRepository } from '../types';

@Injectable()
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  // Read: cache result + tag it
  @Cached({
    key: 'user:{0}',
    ttl: 300,
    tags: (id: string) => [`user:${id}`, 'users'],
  })
  async getUser(id: string): Promise<User> {
    return this.repository.findOne(id);
  }

  // Update: invalidate related caches after success
  @InvalidateTags({
    tags: (id: string) => [`user:${id}`, 'users'],
    when: 'after',
  })
  async updateUser(id: string, data: UpdateDto): Promise<User> {
    return this.repository.update(id, data);
  }

  // Delete: invalidate + publish for distributed nodes
  @InvalidateOn({
    events: ['user.deleted'],
    tags: (result: any, [id]: any[]) => [`user:${id}`, 'users'],
    publish: true,
  })
  async deleteUser(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
