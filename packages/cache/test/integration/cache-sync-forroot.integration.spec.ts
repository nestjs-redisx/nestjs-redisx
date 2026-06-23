/**
 * Integration test for synchronous RedisModule.forRoot() with a plugin.
 *
 * Regression guard: plugins inject REDIS_CLIENTS_INITIALIZATION, which must be
 * provided by the synchronous forRoot() path (not only forRootAsync). Without
 * it, plugin Redis-driver resolution fails at DI bootstrap.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_SERVICE } from '../../src/shared/constants';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';

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

describeIntegration('RedisModule.forRoot (sync) + plugin', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await flushRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [
        // Synchronous forRoot with a plugin — must bootstrap without a DI error.
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new CachePlugin({ l1: { enabled: false } })],
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
    await app.close();
  });

  it('resolves the plugin service and performs a real cache round-trip', async () => {
    // Given
    const cache = app.get<ICacheService>(CACHE_SERVICE);

    // When
    await cache.set('sync:key', { ok: true }, { ttl: 60 });
    const value = await cache.get<{ ok: boolean }>('sync:key');

    // Then
    expect(value).toEqual({ ok: true });
  });
});
