import { Injectable } from '@nestjs/common';
import { Cached } from '@nestjs-redisx/cache';
import { User, UserRepository } from '../types';

@Injectable()
export class UserService {
  constructor(private readonly repository: UserRepository) {}

  @Cached({ key: 'user:{0}', ttl: 300 })
  async getUser(id: string): Promise<User> {
    return this.repository.findOne(id);
  }
}
