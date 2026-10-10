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

import { LeaderPlugin, LEADER_SERVICE, LEADER_STORE, type ILeaderService, type ILeaderStore } from '../../src';

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

describeIntegration('LeaderPlugin - live Redis, two competing instances', () => {
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

    // Then - first boot wins, both agree on who leads
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

    // When - the leader's app closes (lease released, no TTL wait)
    await appA.close();
    apps.shift();

    // Then - the follower takes over within a few retry intervals
    await wait(RETRY * 3);
    expect(b.isLeader()).toBe(true);
    expect(await redis.get('leader:default')).toBe('live-b');
  });

  it('recovers from a CRASHED leader once its lease expires', async () => {
    // Given - a dead node's lease with a short remaining TTL, planted directly
    await redis.set('leader:default', 'crashed-node', 'PX', 700);

    // When - a healthy instance boots while the seat is still taken
    const app = await bootInstance('live-a');
    apps.push(app);
    const service = app.get<ILeaderService>(LEADER_SERVICE);
    expect(service.isLeader()).toBe(false);

    // Then - after the dead lease expires, the healthy instance wins
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

    // Then - B leads; A stays out for its cooldown even though it keeps ticking
    expect(b.isLeader()).toBe(true);
    expect(a.isLeader()).toBe(false);
    expect(await redis.get('leader:default')).toBe('live-b');
  });

  it('re-leads instantly after a restart with the same instanceId (stale own lease re-claimed)', async () => {
    // Given - the previous run's lease is still unexpired (unclean restart:
    // the process died without releasing, then came back with the same id)
    await redis.set('leader:default', 'live-a', 'PX', TTL);

    // When - the "restarted" process boots
    const app = await bootInstance('live-a');
    apps.push(app);
    const service = app.get<ILeaderService>(LEADER_SERVICE);

    // Then - leader immediately (no ttl wait, unlike a foreign crashed lease),
    // and the lease TTL was refreshed by the re-claim
    expect(service.isLeader()).toBe(true);
    expect(await redis.get('leader:default')).toBe('live-a');
    expect(await redis.pttl('leader:default')).toBeGreaterThan(TTL / 2);
  });

  it('acquire re-claims only an own lease - the script contract on live Redis', async () => {
    // Given - the seat belongs to another (dead) node for the next 5 seconds
    await redis.set('leader:default', 'other-node', 'PX', 5_000);
    const app = await bootInstance('live-a'); // boots as follower
    apps.push(app);
    const store = app.get<ILeaderStore>(LEADER_STORE);

    // When/Then - a competitor cannot take or extend the seat...
    expect(await store.acquire('leader:default', 'live-a', TTL)).toBe(false);

    // ...while the holder itself re-claims (extends) it
    expect(await store.acquire('leader:default', 'other-node', 5_000)).toBe(true);
    expect(await redis.get('leader:default')).toBe('other-node');
  });

  it('re-claims an own stale lease under maxmemory pressure - the OOM-denied SET must not shadow the re-claim branch', async () => {
    // Given - an own stale lease on a side key while Redis rejects writes.
    // Redis 7.x checks denyoom per redis.call: GET+PEXPIRE stay allowed, SET
    // does not - so the re-claim check must run BEFORE the SET in the script.
    const app = await bootInstance('live-a');
    apps.push(app);
    const store = app.get<ILeaderStore>(LEADER_STORE);
    await redis.set('leader:oom-test', 'oom-node', 'PX', 5_000);
    await redis.config('SET', 'maxmemory', '1');
    try {
      // When/Then - the own-id re-claim still lands (pre-fix: every acquire
      // OOM-aborted at the leading SET and the lease died within one ttl)...
      expect(await store.acquire('leader:oom-test', 'oom-node', 5_000)).toBe(true);
      expect(await redis.get('leader:oom-test')).toBe('oom-node');

      // ...while a FRESH acquire fails loudly with the real cause, never silently
      await expect(store.acquire('leader:oom-fresh', 'new-node', 5_000)).rejects.toThrow(/OOM/);
    } finally {
      await redis.config('SET', 'maxmemory', '0');
      await redis.del('leader:oom-test');
    }
  });

  it('keeps renewing so the lease outlives many TTL windows', async () => {
    // Given
    const app = await bootInstance('live-a');
    apps.push(app);
    const service = app.get<ILeaderService>(LEADER_SERVICE);

    // When - several full TTL windows pass
    await wait(TTL * 2);

    // Then - still the leader, and the key TTL is being refreshed
    expect(service.isLeader()).toBe(true);
    const pttl = await redis.pttl('leader:default');
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL);
  });
});
