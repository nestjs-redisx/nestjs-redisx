/**
 * Integration tests for the cache `stampede.fallback` option against a real
 * Redis instance.
 *
 * Two concurrent getOrSet calls for the same key contend: the first becomes the
 * leader running a slow loader, the second waits and times out (small
 * waitTimeout). The configured fallback then decides what the waiter gets.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_SERVICE } from '../../src/shared/constants';
import { StampedeError } from '../../src/shared/errors';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

async function createService(fallback: 'load' | 'error' | 'null'): Promise<{ module: TestingModule; cache: ICacheService }> {
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [
          new CachePlugin({
            l1: { enabled: false },
            stampede: { enabled: true, lockTimeout: 5000, waitTimeout: 200, fallback },
          }),
        ],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
      }),
    ],
  }).compile();

  await module.init();
  return { module, cache: module.get<ICacheService>(CACHE_SERVICE) };
}

describeIntegration('CachePlugin — stampede fallback', () => {
  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
  });

  it("fallback 'load': a waiter that times out loads directly and still resolves", async () => {
    // Given
    const { module, cache } = await createService('load');
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls++;
      await sleep(600); // longer than waitTimeout (200ms)
      return 'value';
    };

    // When - two concurrent calls for the same key
    const results = await Promise.all([cache.getOrSet('stampede:load', loader), cache.getOrSet('stampede:load', loader)]);

    // Then - both resolve (the waiter fell back to loading) and the loader ran
    // more than once (leader + fallback load)
    expect(results[0]).toBe('value');
    expect(results[1]).toBe('value');
    expect(calls).toBeGreaterThanOrEqual(2);

    await module.close();
  });

  it("fallback 'error': a waiter that times out rejects with StampedeError", async () => {
    // Given
    const { module, cache } = await createService('error');
    const loader = async (): Promise<string> => {
      await sleep(600);
      return 'value';
    };

    // When
    const settled = await Promise.allSettled([cache.getOrSet('stampede:error', loader), cache.getOrSet('stampede:error', loader)]);

    // Then - one call wins (leader) and one rejects with StampedeError (waiter)
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(StampedeError);

    await module.close();
  });
});
