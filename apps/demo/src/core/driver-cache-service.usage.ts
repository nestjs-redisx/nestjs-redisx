import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

// Works with both ioredis and node-redis
@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  async cache(key: string, value: string, ttl: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttl });
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
