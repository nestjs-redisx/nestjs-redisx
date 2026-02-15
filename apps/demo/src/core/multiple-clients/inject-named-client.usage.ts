import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';

@Injectable()
export class CacheService {
  constructor(
    @InjectRedis('cache')
    private readonly cacheClient: IRedisDriver,
  ) {}

  async get(key: string): Promise<string | null> {
    return this.cacheClient.get(key);
  }

  async set(key: string, value: string, ttl: number): Promise<void> {
    await this.cacheClient.set(key, value, { ex: ttl });
  }
}
