/**
 * Integration tests for RateLimitPlugin against a real Redis instance and a
 * real NestJS HTTP pipeline.
 *
 * Focus: the limit must be consumed at most once per request even when the
 * guard is bound more than once for the same route (the `@RateLimit` decorator
 * binds the guard via `UseGuards`, and NestJS does not deduplicate the same
 * guard across class- and method-level binding scopes).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import request from 'supertest';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { RateLimitPlugin } from '../../src/rate-limit.plugin';
import { RateLimit } from '../../src/rate-limit/api/decorators/rate-limit.decorator';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const LIMIT = 10;

/** Decorated on the method only — guard bound once. */
@Controller('single')
class SingleController {
  @Get()
  @RateLimit({ key: 'rl-single', points: LIMIT, duration: 60, algorithm: 'fixed-window' })
  get(): { ok: boolean } {
    return { ok: true };
  }
}

/** Decorated on BOTH class and method — guard bound twice for the same route. */
@RateLimit({ key: 'rl-double', points: LIMIT, duration: 60, algorithm: 'fixed-window' })
@Controller('double')
class DoubleController {
  @Get()
  @RateLimit({ key: 'rl-double', points: LIMIT, duration: 60, algorithm: 'fixed-window' })
  get(): { ok: boolean } {
    return { ok: true };
  }
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('RateLimitPlugin — single consumption per request', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await flushRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new RateLimitPlugin({ defaultAlgorithm: 'fixed-window' })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
      controllers: [SingleController, DoubleController],
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

  it('consumes one point per request for a method-only decorated route (baseline)', async () => {
    // When
    const res = await request(app.getHttpServer()).get('/single').expect(200);

    // Then - a single point consumed: remaining = LIMIT - 1
    expect(res.headers['x-ratelimit-limit']).toBe(String(LIMIT));
    expect(res.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
  });

  it('consumes one point per request when the guard is bound on both class and method', async () => {
    // When - the route is decorated twice; without idempotent consumption this
    // would charge 2 points and report remaining = LIMIT - 2.
    const res = await request(app.getHttpServer()).get('/double').expect(200);

    // Then
    expect(res.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
  });

  it('decrements by exactly one across consecutive requests on the double-bound route', async () => {
    // When
    const first = await request(app.getHttpServer()).get('/double').expect(200);
    const second = await request(app.getHttpServer()).get('/double').expect(200);

    // Then
    expect(first.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
    expect(second.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 2));
  });

  it('allows exactly LIMIT requests before returning 429 on the double-bound route', async () => {
    // When - exhaust the limit
    for (let i = 0; i < LIMIT; i++) {
      await request(app.getHttpServer()).get('/double').expect(200);
    }

    // Then - the next request is rejected (proves only LIMIT points were charged)
    await request(app.getHttpServer()).get('/double').expect(429);
  });
});
