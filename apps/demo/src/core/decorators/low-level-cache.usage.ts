import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';

@Injectable()
export class LowLevelCacheService {
  constructor(
    @InjectRedis('cache')
    private readonly redis: IRedisDriver,
  ) {}

  // Direct driver access
  async pipeline(): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.set('key1', 'value1');
    pipe.set('key2', 'value2');
    await pipe.exec();
  }
}
