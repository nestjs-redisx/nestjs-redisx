import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';

@Injectable()
export class CacheService {
  constructor(
    @InjectRedis()
    private readonly redis: IRedisDriver,
  ) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, { ex: ttl });
    } else {
      await this.redis.set(key, value);
    }
  }
}
