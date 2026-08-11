import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

/**
 * Run the cache entirely in local process memory — NO Redis.
 *
 * With `mode: 'l1-only'` the app boots even when no Redis is reachable. Tags,
 * SWR, stale-if-error and singleflight all keep working, but SINGLE-INSTANCE
 * (nothing is shared across processes; invalidation is local). Size the cache
 * via the `l1` block. The `clients` block is still required by RedisModule but
 * is never connected in this mode.
 */
@Module({
  imports: [
    RedisModule.forRoot({
      // Required by RedisModule, but never connected in l1-only mode.
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CachePlugin({
          mode: 'l1-only',
          // Size the single in-memory tier via the l1 block.
          l1: { maxSize: 1000, ttl: 60, evictionPolicy: 'lru' },
          tags: { enabled: true },
          swr: { enabled: true, defaultStaleTime: 30 },
        }),
      ],
    }),
  ],
})
export class AppModule {}
