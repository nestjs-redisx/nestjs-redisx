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
// Isolated Redis DB so parallel integration files never flush each other's keys.
const REDIS_DB = 1;

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB, lazyConnect: true });
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
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB } }),
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

  it('getOrSet immediately after invalidateTags reloads fresh data (no stale stampede-flight window)', async () => {
    // Given — a value cached via getOrSet with a tag (the load registers a
    // stampede flight for the key)
    const v1 = await cache.getOrSet('user:42', async () => 'V1', { tags: ['users'] });
    expect(v1).toBe('V1');

    // When — the tag is invalidated (key really deleted from Redis)...
    await cache.invalidateTags(['users']);
    expect(await cache.get('user:42')).toBeNull();

    // ...and the very next getOrSet arrives immediately (< 100ms), the classic
    // mutation -> invalidateTags -> instant refetch pattern (SSE/TanStack Query)
    const v2 = await cache.getOrSet('user:42', async () => 'V2');

    // Then — the loader MUST run and the fresh value MUST be cached; a
    // lingering resolved stampede flight would silently return 'V1'
    expect(v2).toBe('V2');
    expect(await cache.get('user:42')).toBe('V2');
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
