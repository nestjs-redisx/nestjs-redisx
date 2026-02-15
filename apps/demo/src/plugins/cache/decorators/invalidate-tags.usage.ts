import { Injectable } from '@nestjs/common';
import { InvalidateTags } from '@nestjs-redisx/cache';
import { User, UpdateDto, UserRepository } from '../types';

@Injectable()
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  // Invalidate after method execution
  @InvalidateTags({
    tags: (id: string) => [`user:${id}`, 'users'],
    when: 'after',
  })
  async updateUser(id: string, data: UpdateDto): Promise<User> {
    return this.repository.update(id, data);
  }

  // Invalidate before method execution
  @InvalidateTags({
    tags: (id: string) => [`user:${id}`, 'users'],
    when: 'before',
  })
  async deleteUser(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
