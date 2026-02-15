import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class DataService {
  constructor(private readonly redis: RedisService) {}

  async read(key: string): Promise<string | null> {
    const client = await this.redis.getClient('read');
    return client.get(key);
  }

  async write(key: string, value: string): Promise<void> {
    const client = await this.redis.getClient('write');
    await client.set(key, value);
  }
}
