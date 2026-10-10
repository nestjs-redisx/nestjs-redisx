/**
 * End-to-end validation on the in-memory driver - NO Redis. Exercises the
 * full stack (service -> atomic Lua scripts -> memory Lua interpreter)
 * through production code, including the @WithSemaphore decorator and a
 * second service instance competing over the SAME store (two "application
 * instances").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { SemaphorePlugin, SemaphoreService, WithSemaphore, SEMAPHORE_SERVICE, SEMAPHORE_STORE, SemaphoreAcquisitionError, type ISemaphoreService, type ISemaphoreStore } from '../../src';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

@Injectable()
class BoundedWorker {
  concurrent = 0;
  peak = 0;

  @WithSemaphore({ key: 'memory:render', permits: 2, ttl: 2_000 })
  async render(): Promise<void> {
    this.concurrent++;
    this.peak = Math.max(this.peak, this.concurrent);
    await wait(50);
    this.concurrent--;
  }
}

describe('SemaphorePlugin on the in-memory driver (no Redis)', () => {
  let app: TestingModule;
  let serviceA: ISemaphoreService;
  let serviceB: SemaphoreService;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'unused', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new SemaphorePlugin({ retry: { maxRetries: 10, initialDelay: 10, maxDelay: 20, multiplier: 1 } })],
        }),
      ],
      providers: [BoundedWorker],
    }).compile();
    await app.init();

    serviceA = app.get<ISemaphoreService>(SEMAPHORE_SERVICE);
    // Second competing "instance" over the SAME store
    serviceB = new SemaphoreService({ retry: { maxRetries: 0, initialDelay: 10, maxDelay: 10, multiplier: 1 }, autoRenew: { enabled: false } }, app.get<ISemaphoreStore>(SEMAPHORE_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should enforce the capacity across two service instances (real Lua on the memory interpreter)', async () => {
    // Given - capacity 2, both seats taken by instance A
    const p1 = await serviceA.acquire('jobs', 2, { ttl: 2_000 });
    const p2 = await serviceA.acquire('jobs', 2, { ttl: 2_000 });

    // When - instance B tries the third seat
    const third = await serviceB.tryAcquire('jobs', 2);

    // Then - full
    expect(third).toBeNull();
    expect(await serviceB.usedPermits('jobs')).toBe(2);
    expect(await serviceB.availablePermits('jobs', 2)).toBe(0);

    // And releasing one seat lets B in
    await p1.release();
    const fourth = await serviceB.tryAcquire('jobs', 2);
    expect(fourth).not.toBeNull();

    await p2.release();
    await fourth!.release();
  });

  it('should free a crashed holder seat after its TTL (expired permits are swept inside acquire)', async () => {
    // Given - a "crashed" holder: acquired with a short TTL, never released,
    // auto-renewal off
    const crashed = await serviceA.acquire('crashy', 1, { ttl: 120, autoRenew: false });
    expect(await serviceB.tryAcquire('crashy', 1)).toBeNull();

    // When - the lease lapses
    await wait(150);

    // Then - the seat is takeable again
    const takeover = await serviceB.tryAcquire('crashy', 1);
    expect(takeover).not.toBeNull();

    // And the crashed permit's release reports the seat as already lost
    await expect(crashed.release()).rejects.toThrow(/not held/);
    await takeover!.release();
  });

  it('should keep a long-running holder seated via auto-renewal', async () => {
    // Given - TTL shorter than the work, auto-renew on (default)
    const permit = await serviceA.acquire('long', 1, { ttl: 150 });

    // When - work outlives the TTL by several renewal rounds
    await wait(400);

    // Then - still held, still blocking the second seat
    expect(await permit.isHeld()).toBe(true);
    expect(await serviceB.tryAcquire('long', 1)).toBeNull();

    await permit.release();
  });

  it('should extend a permit and report isHeld through the store scripts', async () => {
    // Given
    const permit = await serviceA.acquire('extend', 1, { ttl: 200, autoRenew: false });

    // When
    await permit.extend(2_000);
    await wait(250); // past the ORIGINAL ttl

    // Then - extension kept the seat
    expect(await permit.isHeld()).toBe(true);
    await permit.release();
  });

  it('should bound @WithSemaphore-decorated methods and queue the rest', async () => {
    // Given
    const worker = app.get(BoundedWorker);

    // When - 5 concurrent calls against capacity 2
    await Promise.all(Array.from({ length: 5 }, () => worker.render()));

    // Then - the observed concurrency never exceeded the capacity
    expect(worker.peak).toBeLessThanOrEqual(2);
    expect(worker.concurrent).toBe(0);
    expect(await serviceA.usedPermits('memory:render')).toBe(0);
  });

  it('should throw SemaphoreAcquisitionError when the wait budget runs out', async () => {
    // Given - seat taken
    const permit = await serviceA.acquire('budget', 1);

    // When/Then
    await expect(serviceB.acquire('budget', 1, { waitTimeout: 25 })).rejects.toThrow(SemaphoreAcquisitionError);

    await permit.release();
  });

  it('should force-release every seat (admin recovery)', async () => {
    // Given
    await serviceA.acquire('stuck', 3);
    await serviceA.acquire('stuck', 3);

    // When
    const freed = await serviceA.forceReleaseAll('stuck');

    // Then
    expect(freed).toBe(2);
    expect(await serviceA.usedPermits('stuck')).toBe(0);
  });

  it('should NOT yank seats on shutdown - they lapse by TTL unless the owner releases first', async () => {
    // Given - a held seat whose protected work may still be running
    const permit = await serviceA.acquire('shutdown', 1, { ttl: 200 });
    expect(await serviceB.tryAcquire('shutdown', 1)).toBeNull();

    // When - the shutdown hook runs (what app.close() invokes)
    (serviceA as SemaphoreService).onModuleDestroy();

    // Then - the seat is STILL protected (no silent split bound) ...
    expect(await serviceB.tryAcquire('shutdown', 1)).toBeNull();

    // ... the owner's own finally still releases instantly ...
    await permit.release();
    const takeover = await serviceB.tryAcquire('shutdown', 1);
    expect(takeover).not.toBeNull();
    await takeover!.release();
  });

  it('should let an abandoned seat lapse by TTL after shutdown (renewal stopped - crash bound)', async () => {
    // Given - auto-renewed seat, then shutdown with the work never finishing
    await serviceA.acquire('abandoned', 1, { ttl: 150 });
    (serviceA as SemaphoreService).onModuleDestroy();
    expect(await serviceB.tryAcquire('abandoned', 1)).toBeNull();

    // When - past the remaining TTL (renewal no longer extends it)
    await wait(200);

    // Then - the seat freed itself, exactly like a crash
    const takeover = await serviceB.tryAcquire('abandoned', 1);
    expect(takeover).not.toBeNull();
    await takeover!.release();
  });
});
