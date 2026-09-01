import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';
import { LeaderService } from '../../src/leader/application/services/leader.service';
import type { ILeaderStore } from '../../src/leader/application/ports/leader-store.port';
import type { ILeaderPluginOptions } from '../../src/shared/types';
import { clearRegisteredLeaderGroups } from '../../src/leader/api/decorators/leader-only.decorator';

const TTL = 15_000;
const RENEW = 5_000;
const RETRY = 2_000;

/**
 * Interleaving attacks: a store call that is IN FLIGHT when stepDown()
 * changes the election's intent must not resurrect or grant leadership when
 * it finally lands.
 */
describe('LeaderService — in-flight store call races', () => {
  let store: MockedObject<ILeaderStore>;
  let options: ILeaderPluginOptions;
  let service: LeaderService;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    clearRegisteredLeaderGroups();

    store = {
      acquire: vi.fn().mockResolvedValue(true),
      renew: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      getHolder: vi.fn().mockResolvedValue(null),
    } as unknown as MockedObject<ILeaderStore>;

    options = {
      instanceId: 'node-1',
      keyPrefix: 'leader:',
      ttlMs: TTL,
      renewIntervalMs: RENEW,
      retryIntervalMs: RETRY,
    };
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    vi.useRealTimers();
  });

  it('must NOT re-promote when a stepDown lands while a renewal is in flight', async () => {
    // Given — a leader whose next renewal hangs on the wire
    const onLost = vi.fn();
    service = new LeaderService({ ...options, onLost }, store);
    await service.onModuleInit();
    expect(service.isLeader()).toBe(true);

    let resolveRenew!: (v: boolean) => void;
    store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
    await vi.advanceTimersByTimeAsync(RENEW); // tick fires, renew now pending

    // When — the operator steps down mid-renewal, then the stale renewal
    // confirmation arrives
    await service.stepDown();
    expect(service.isLeader()).toBe(false);
    resolveRenew(true);
    await vi.advanceTimersByTimeAsync(0); // let the suspended tick finish

    // Then — the stale confirmation must not resurrect local leadership
    // (the lease key was already released; another instance may hold it)
    expect(service.isLeader()).toBe(false);

    // And — exactly one loss event, with the stepdown reason
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith('default', 'stepdown');
  });

  it('must NOT accept leadership from an in-flight acquire that lands during a stepDown cooldown', async () => {
    // Given — a follower whose acquire attempt hangs on the wire
    const onElected = vi.fn();
    store.acquire.mockResolvedValueOnce(false); // stay follower at bootstrap
    service = new LeaderService({ ...options, onElected }, store);
    await service.onModuleInit();
    onElected.mockClear();

    let resolveAcquire!: (v: boolean) => void;
    store.acquire.mockImplementation(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
    await vi.advanceTimersByTimeAsync(RETRY); // retry tick fires, acquire pending

    // When — stepDown starts a cooldown while the acquire is mid-flight, and
    // then the acquire SUCCEEDS on the wire (we now hold the remote key)
    await service.stepDown();
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0);

    // Then — no local promotion during the cooldown...
    expect(service.isLeader()).toBe(false);
    expect(onElected).not.toHaveBeenCalled();

    // ...and the remotely-won key is released so other instances are not
    // locked out for a full ttl by a seat nobody claims
    expect(store.release).toHaveBeenCalledWith('leader:default', 'node-1');
  });

  it('must release a lease won by an in-flight acquire that lands AFTER onModuleDestroy', async () => {
    // Given — a follower whose acquire attempt hangs on the wire
    const onElected = vi.fn();
    store.acquire.mockResolvedValueOnce(false);
    service = new LeaderService({ ...options, onElected }, store);
    await service.onModuleInit();
    onElected.mockClear();

    let resolveAcquire!: (v: boolean) => void;
    store.acquire.mockImplementation(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
    await vi.advanceTimersByTimeAsync(RETRY); // retry tick fires, acquire pending

    // When — the app shuts down while the acquire is in flight, then the
    // acquire SUCCEEDS on the wire (a dead process now holds the key)
    await service.onModuleDestroy();
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0);

    // Then — no election event during shutdown, and the accidentally-won key
    // is released so failover is not blocked for a full ttl
    expect(onElected).not.toHaveBeenCalled();
    expect(service.isLeader()).toBe(false);
    expect(store.release).toHaveBeenCalledWith('leader:default', 'node-1');
  });

  it('must not double-fire onLost when a renewal rejection lands after onModuleDestroy', async () => {
    // Given — a leader whose renewal hangs
    const onLost = vi.fn();
    service = new LeaderService({ ...options, onLost }, store);
    await service.onModuleInit();
    let resolveRenew!: (v: boolean) => void;
    store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
    await vi.advanceTimersByTimeAsync(RENEW);

    // When — shutdown sweeps the lease, then the stale renewal comes back false
    await service.onModuleDestroy();
    resolveRenew(false);
    await vi.advanceTimersByTimeAsync(0);

    // Then — exactly one loss event, the shutdown one
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith('default', 'shutdown');
  });

  it('keeps the election loop alive even when the metrics service throws', async () => {
    // Given — a user-supplied metrics implementation that throws on every call
    const metrics = {
      incrementCounter: vi.fn(() => {
        throw new Error('metrics backend down');
      }),
    };
    service = new LeaderService(options, store, metrics);

    // When — bootstrap elects (metrics throws on the elected counter)
    await service.onModuleInit();
    expect(service.isLeader()).toBe(true);

    // And — a demotion + re-election cycle passes through the throwing metrics
    store.renew.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(RENEW);
    expect(service.isLeader()).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY);

    // Then — the loop survived every throwing emit and re-elected
    expect(service.isLeader()).toBe(true);
    expect(metrics.incrementCounter).toHaveBeenCalled();
  });

  it('keeps the election loop alive after an abandoned in-flight tick', async () => {
    // Given — the stepDown race from above has happened
    service = new LeaderService(options, store);
    await service.onModuleInit();
    let resolveRenew!: (v: boolean) => void;
    store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
    await vi.advanceTimersByTimeAsync(RENEW);
    await service.stepDown();
    resolveRenew(true);
    await vi.advanceTimersByTimeAsync(0);
    store.acquire.mockClear();
    store.acquire.mockResolvedValue(true);

    // When — the cooldown fully elapses
    await vi.advanceTimersByTimeAsync(TTL + RETRY);

    // Then — the loop is still ticking and candidacy resumed
    expect(store.acquire).toHaveBeenCalled();
    expect(service.isLeader()).toBe(true);
  });
});
