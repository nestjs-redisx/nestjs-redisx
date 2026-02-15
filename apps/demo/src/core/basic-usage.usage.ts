import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';
import { User } from './types';

@Injectable()
export class UserService {
  constructor(private readonly redis: RedisService) {}

  async cacheUser(id: string, user: User): Promise<void> {
    await this.redis.set(`user:${id}`, JSON.stringify(user), { ex: 3600 });
  }

  async getUser(id: string): Promise<User | null> {
    const data = await this.redis.get(`user:${id}`);
    return data ? JSON.parse(data) : null;
  }
}
