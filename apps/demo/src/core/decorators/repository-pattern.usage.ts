import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';
import { User } from '../types';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRedis('users')
    private readonly redis: IRedisDriver,
  ) {}

  async findById(id: string): Promise<User | null> {
    const data = await this.redis.hgetall(`user:${id}`);
    if (!Object.keys(data).length) return null;
    return this.mapToUser(data);
  }

  async save(user: User): Promise<void> {
    await this.redis.hmset(`user:${user.id}`, this.mapFromUser(user));
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(`user:${id}`);
  }

  private mapToUser(data: Record<string, string>): User {
    return {
      id: data.id,
      name: data.name,
      email: data.email,
      createdAt: new Date(data.createdAt),
    };
  }

  private mapFromUser(user: User): Record<string, string> {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
