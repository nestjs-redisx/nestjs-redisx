import { NestFactory } from '@nestjs/core';
import { CachePlugin, CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';
import { RedisTestingModule } from '@nestjs-redisx/testing';

/**
 * Boots a Nest context backed by the in-memory driver and exercises the real
 * CacheService. No Redis runs — `getOrSet` invokes the loader once and serves
 * the cached value on the second call. Returns the loader call count (1).
 */
export async function cacheLoadsOnce(): Promise<number> {
  const app = await NestFactory.createApplicationContext(RedisTestingModule.forRoot({ plugins: [new CachePlugin()] }), { logger: false });

  const cache = app.get<ICacheService>(CACHE_SERVICE);

  let calls = 0;
  const loader = async (): Promise<{ id: number }> => {
    calls += 1;
    return { id: 1 };
  };

  await cache.getOrSet('user:1', loader, { ttl: 60 });
  await cache.getOrSet('user:1', loader, { ttl: 60 });

  await app.close();
  return calls; // 1
}
