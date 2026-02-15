import { Injectable, Inject, Optional } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';
import { Cached, CacheService, CACHE_SERVICE } from '@nestjs-redisx/cache';
import { WithLock } from '@nestjs-redisx/locks';
import { StreamProducerService, STREAM_PRODUCER } from '@nestjs-redisx/streams';

@Injectable()
export class TestService {
  constructor(
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(CACHE_SERVICE) private readonly cacheService: CacheService,
    @Inject(STREAM_PRODUCER) private readonly streamProducer: StreamProducerService,
  ) {}

  @Cached({ ttl: 60, tags: ['test'] })
  async getCachedData(key: string): Promise<{ key: string; value: string; timestamp: number }> {
    return { key, value: `data-${key}`, timestamp: Date.now() };
  }

  async invalidateTags(tags: string[]): Promise<void> {
    await this.cacheService.invalidateTags(tags);
  }

  @WithLock({ key: 'pack-test-lock', ttl: 5000 })
  async withLock(): Promise<{ locked: true; timestamp: number }> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { locked: true, timestamp: Date.now() };
  }

  async publishMessage(message: string): Promise<{ streamId: string }> {
    const id = await this.streamProducer.publish('pack-test-stream', { message });
    return { streamId: id };
  }
}
