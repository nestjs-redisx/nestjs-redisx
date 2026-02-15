import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class HighLevelCacheService {
  constructor(private readonly redis: RedisService) {}

  // Higher-level API
  async cache(key: string, value: string): Promise<void> {
    await this.redis.set(key, value, { ex: 3600 });
  }

  // Dynamic client selection
  async getFromClient(clientName: string, key: string): Promise<string | null> {
    const client = await this.redis.getClient(clientName);
    return client.get(key);
  }
}
