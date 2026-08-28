/**
 * Integration tests against a REAL Redis instance with two real NestJS
 * applications competing for the same lease:
 * - exactly one leader across instances;
 * - instant failover on graceful shutdown (released lease);
 * - crash failover bounded by the lease TTL;
 * - voluntary stepDown handover.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';

import { LeaderPlugin, LEADER_SERVICE, type ILeaderService } from '../../src';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const TTL = 600;
const RENEW = 150;
const RETRY = 150;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

async function bootInstance(instanceId: string): Promise<TestingModule> {
  const app = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [new LeaderPlugin({ ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, instanceId })],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
      }),
    ],
  }).compile();
  await app.init();
  return app;
}

describeIntegration('LeaderPlugin — live Redis, two competing instances', () => {
  let redis: Redis;
  let apps: TestingModule[];

  beforeEach(async () => {
    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
    await redis.connect();
    await redis.del('leader:default');
    apps = [];
  });

  afterEach(async () => {
    for (const app of apps) {
      await app.close().catch(() => undefined);
    }
    await redis.del('leader:default');
    await redis.quit();
  });

  it('elects exactly one leader and stores its id in the election key', async () => {
    // When
    const appA = await bootInstance('live-a');
    apps.push(appA);
    const appB = await bootInstance('live-b');
    apps.push(appB);

    const a = appA.get<ILeaderService>(LEADER_SERVICE);
    const b = appB.get<ILeaderService>(LEADER_SERVICE);

    // Then — first boot wins, both agree on who leads
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    expect(await b.getLeaderId()).toBe('live-a');
    expect(await redis.get('leader:default')).toBe('live-a');
  });

  it('fails over instantly when the leader shuts down gracefully', async () => {
    // Given
    const appA = await bootInstance('live-a');
    apps.push(appA);
    const appB = await bootInstance('live-b');
    apps.push(appB);
    const b = appB.get<ILeaderService>(LEADER_SERVICE);
    expect(b.isLeader()).toBe(false);

    // When — the leader's app closes (lease released, no TTL wait)
    await appA.close();
    apps.shift();

    // Then — the follower takes over within a few retry intervals
    await wait(RETRY * 3);
    expect(b.isLeader()).toBe(true);
    expect(await redis.get('leader:default')).toBe('live-b');
  });

  it('recovers from a CRASHED leader once its lease expires', async () => {
    // Given — a dead node's lease with a short remaining TTL, planted directly
    await redis.set('leader:default', 'crashed-node', 'PX', 700);

    // When — a healthy instance boots while the seat is still taken
    const app = await bootInstance('live-a');
    apps.push(app);
    const service = app.get<ILeaderService>(LEADER_SERVICE);
    expect(service.isLeader()).toBe(false);

    // Then — after the dead lease expires, the healthy instance wins
    await wait(700 + RETRY * 3);
    expect(service.isLeader()).toBe(true);
    expect(await redis.get('leader:default')).toBe('live-a');
  });

  it('hands leadership over on stepDown and does not immediately steal it back', async () => {
    // Given
    const appA = await bootInstance('live-a');
    apps.push(appA);
    const appB = await bootInstance('live-b');
    apps.push(appB);
    const a = appA.get<ILeaderService>(LEADER_SERVICE);
    const b = appB.get<ILeaderService>(LEADER_SERVICE);
    expect(a.isLeader()).toBe(true);

    // When
    await a.stepDown();
    await wait(RETRY * 3);

    // Then — B leads; A stays out for its cooldown even though it keeps ticking
    expect(b.isLeader()).toBe(true);
    expect(a.isLeader()).toBe(false);
    expect(await redis.get('leader:default')).toBe('live-b');
  });

  it('keeps renewing so the lease outlives many TTL windows', async () => {
    // Given
    const app = await bootInstance('live-a');
    apps.push(app);
    const service = app.get<ILeaderService>(LEADER_SERVICE);

    // When — several full TTL windows pass
    await wait(TTL * 2);

    // Then — still the leader, and the key TTL is being refreshed
    expect(service.isLeader()).toBe(true);
    const pttl = await redis.pttl('leader:default');
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL);
  });
});
