/**
 * End-to-end validation on the in-memory driver - NO Redis. Exercises the
 * full stack (service -> CAS Lua scripts -> memory Lua interpreter) through
 * production code.
 *
 * A second LeaderService instance ("node-b") is constructed against the SAME
 * store, simulating a second application instance competing for the same
 * lease.
 *
 * NOTE: the election loop reads time via Date.now(), so this test uses small
 * real timings and real waits (⚠ real timers).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { LeaderPlugin, LeaderService, LeaderOnly, LEADER_SERVICE, LEADER_STORE, type ILeaderService, type ILeaderStore } from '../../src';
import { clearRegisteredLeaderGroups } from '../../src/leader/api/decorators/leader-only.decorator';

const TTL = 400;
const RENEW = 100;
const RETRY = 100;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

@Injectable()
class SingletonJobs {
  runs = 0;

  @LeaderOnly()
  async nightly(): Promise<string | undefined> {
    this.runs++;
    return 'ran';
  }
}

describe('LeaderPlugin on the in-memory driver (no Redis)', () => {
  let app: TestingModule;
  let serviceA: ILeaderService;
  let serviceB: LeaderService;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'unused', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new LeaderPlugin({ ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, instanceId: 'node-a' })],
        }),
      ],
      providers: [SingletonJobs],
    }).compile();
    await app.init();

    serviceA = app.get<ILeaderService>(LEADER_SERVICE);
    // Second competing "instance" over the SAME store
    serviceB = new LeaderService({ ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, instanceId: 'node-b' }, app.get<ILeaderStore>(LEADER_STORE));
    await serviceB.onModuleInit();
  });

  afterEach(async () => {
    await serviceB.onModuleDestroy();
    await app.close();
    clearRegisteredLeaderGroups();
  });

  it('elects exactly one leader between two competing instances', async () => {
    // Then - the app instance booted first and holds the lease
    expect(serviceA.isLeader()).toBe(true);
    expect(serviceB.isLeader()).toBe(false);
    expect(await serviceA.getLeaderId()).toBe('node-a');
    expect(await serviceB.getLeaderId()).toBe('node-a');
  });

  it('keeps the leader stable across many heartbeats', async () => {
    // When - several renew cycles pass
    await wait(RENEW * 4);

    // Then
    expect(serviceA.isLeader()).toBe(true);
    expect(serviceB.isLeader()).toBe(false);
  });

  it('fails over to the follower after a voluntary stepDown', async () => {
    // When
    await serviceA.stepDown();

    // Then - the seat is free and B takes it within one retry interval
    await wait(RETRY * 3);
    expect(serviceB.isLeader()).toBe(true);
    expect(serviceA.isLeader()).toBe(false);
    expect(await serviceA.getLeaderId()).toBe('node-b');
  });

  it('fails over when the leader shuts down gracefully (released lease)', async () => {
    // Given - B is a follower
    expect(serviceB.isLeader()).toBe(false);

    // When - A's process goes away
    await app.get<LeaderService>(LEADER_SERVICE).onModuleDestroy();

    // Then - B wins within a retry interval, no TTL wait needed
    await wait(RETRY * 3);
    expect(serviceB.isLeader()).toBe(true);
  });

  it('gates @LeaderOnly methods by leadership', async () => {
    // Given
    const jobs = app.get(SingletonJobs);

    // When - leader instance runs the method
    const onLeader = await jobs.nightly();

    // Then
    expect(onLeader).toBe('ran');
    expect(jobs.runs).toBe(1);

    // And - after the leader steps down and B takes over, the method skips
    await serviceA.stepDown();
    await wait(RETRY * 3);
    expect(serviceB.isLeader()).toBe(true);
    const onFollower = await jobs.nightly();
    expect(onFollower).toBeUndefined();
    expect(jobs.runs).toBe(1);
  });

  it('runs independent elections per group', async () => {
    // Given - only node-b runs the "reports" election
    const reportsOnly = new LeaderService({ ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, instanceId: 'node-c', groups: ['reports'] }, app.get<ILeaderStore>(LEADER_STORE));
    await reportsOnly.onModuleInit();

    try {
      // Then - node-a leads 'default', node-c leads 'reports'
      expect(serviceA.isLeader('default')).toBe(true);
      expect(reportsOnly.isLeader('reports')).toBe(true);
      expect(await serviceA.getLeaderId('reports')).toBe('node-c');
    } finally {
      await reportsOnly.onModuleDestroy();
    }
  });

  it("re-claims an own lease but never someone else's via the acquire script (memory Lua path)", async () => {
    // Given - node-a already holds the seat (booted first)
    const store = app.get<ILeaderStore>(LEADER_STORE);

    // When/Then - the same holder re-claims, a competitor is rejected
    expect(await store.acquire('leader:default', 'node-a', TTL)).toBe(true);
    expect(await store.acquire('leader:default', 'node-b', TTL)).toBe(false);
    expect(await store.getHolder('leader:default')).toBe('node-a');
  });

  it('re-leads immediately when a stale own lease from a previous run is still present', async () => {
    // Given - a "previous run" of node-r left an unexpired lease behind
    const store = app.get<ILeaderStore>(LEADER_STORE);
    await store.acquire('leader:restart', 'node-r', TTL);

    // When - the process "restarts" with the same instanceId
    const restarted = new LeaderService({ ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, instanceId: 'node-r', groups: ['restart'] }, store);
    await restarted.onModuleInit();

    try {
      // Then - leader right away, no dead ttl window
      expect(restarted.isLeader('restart')).toBe(true);
      expect(await store.getHolder('leader:restart')).toBe('node-r');
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it('reports runIfLeader semantics through the real election', async () => {
    // When
    const ranOnA = await serviceA.runIfLeader(() => 'a-work');
    const ranOnB = await serviceB.runIfLeader(() => 'b-work');

    // Then
    expect(ranOnA).toBe('a-work');
    expect(ranOnB).toBeUndefined();
  });
});
