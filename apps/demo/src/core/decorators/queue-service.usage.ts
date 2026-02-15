import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';

@Injectable()
export class QueueService {
  constructor(
    @InjectRedis('queue')
    private readonly redis: IRedisDriver,
  ) {}

  async enqueue<T>(queue: string, item: T): Promise<void> {
    await this.redis.rpush(queue, JSON.stringify(item));
  }

  async dequeue<T>(queue: string): Promise<T | null> {
    const data = await this.redis.lpop(queue);
    return data ? JSON.parse(data) : null;
  }

  async length(queue: string): Promise<number> {
    return this.redis.llen(queue);
  }
}
