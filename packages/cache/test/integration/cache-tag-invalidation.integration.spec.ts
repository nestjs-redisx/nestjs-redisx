/**
 * Integration tests for tag invalidation against a real Redis instance.
 *
 * Verifies that tag invalidation works end-to-end and that a
 * TagInvalidationError raised by the tag index is preserved (not rewrapped as a
 * generic CacheError) when it reaches the caller through the real service.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_SERVICE, TAG_INDEX } from '../../src/shared/constants';
import { TagInvalidationError } from '../../src/shared/errors';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import type { ITagIndex } from '../../src/tags/application/ports/tag-index.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('CachePlugin — tag invalidation', () => {
  let module: TestingModule;
  let cache: ICacheService;
  let tagIndex: ITagIndex;

  beforeAll(async () => {
    await flushRedis();

    module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new CachePlugin({ l1: { enabled: false }, tags: { enabled: true } })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();

    await module.init();
    cache = module.get<ICacheService>(CACHE_SERVICE);
    tagIndex = module.get<ITagIndex>(TAG_INDEX);
  });

  beforeEach(async () => {
    await flushRedis();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await flushRedis();
    await module.close();
  });

  it('invalidates all keys carrying a tag', async () => {
    // Given
    await cache.set('user:1', { id: 1 }, { tags: ['users'] });
    await cache.set('user:2', { id: 2 }, { tags: ['users'] });

    // When
    const count = await cache.invalidateTag('users');

    // Then
    expect(count).toBeGreaterThanOrEqual(2);
    expect(await cache.get('user:1')).toBeNull();
    expect(await cache.get('user:2')).toBeNull();
  });

  it('preserves TagInvalidationError raised by the tag index', async () => {
    // Given - the tag index fails while invalidating
    vi.spyOn(tagIndex, 'invalidateTag').mockRejectedValue(new TagInvalidationError('users', 'index unavailable'));

    // When/Then - the specific type reaches the caller (not a generic CacheError)
    await expect(cache.invalidateTag('users')).rejects.toBeInstanceOf(TagInvalidationError);
  });
});
