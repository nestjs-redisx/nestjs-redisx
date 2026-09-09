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

  it('must rendezvous with an in-flight acquire on onModuleDestroy and release the wire-won lease before finishing', async () => {
    // Given — a follower whose acquire attempt hangs on the wire
    const onElected = vi.fn();
    store.acquire.mockResolvedValueOnce(false);
    service = new LeaderService({ ...options, onElected }, store);
    await service.onModuleInit();
    onElected.mockClear();

    let resolveAcquire!: (v: boolean) => void;
    store.acquire.mockImplementation(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
    await vi.advanceTimersByTimeAsync(RETRY); // retry tick fires, acquire pending

    // When — the app shuts down while the acquire is in flight
    const destroy = service.onModuleDestroy();
    let destroyed = false;
    void destroy.then(() => (destroyed = true));
    await vi.advanceTimersByTimeAsync(0);

    // Then — shutdown does NOT complete while the result is unknown: a
    // fire-and-forget release after destroy would race the closing Redis
    // clients, stranding a dead process's lease for a full ttl
    expect(destroyed).toBe(false);

    // When — the acquire SUCCEEDS on the wire (the dying process just won)
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0);
    await destroy;

    // Then — no election event during shutdown, and the accidentally-won
    // key was released while the clients were still open
    expect(onElected).not.toHaveBeenCalled();
    expect(service.isLeader()).toBe(false);
    expect(store.release).toHaveBeenCalledWith('leader:default', 'node-1');
  });

  it('must not double-fire onLost when a renewal rejection lands during onModuleDestroy', async () => {
    // Given — a leader whose renewal hangs
    const onLost = vi.fn();
    service = new LeaderService({ ...options, onLost }, store);
    await service.onModuleInit();
    let resolveRenew!: (v: boolean) => void;
    store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
    await vi.advanceTimersByTimeAsync(RENEW);

    // When — shutdown rendezvouses with the pending renewal, which then
    // comes back false (someone else took the seat)
    const destroy = service.onModuleDestroy();
    resolveRenew(false);
    await vi.advanceTimersByTimeAsync(0);
    await destroy;

    // Then — exactly one loss event, the shutdown one
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith('default', 'shutdown');
  });

  it('must not issue a new acquire while a stale quiet release is still on the wire', async () => {
    // Given — a follower whose in-flight acquire was superseded by stepDown,
    // leaving a best-effort release of the raced-won lease PENDING on the wire.
    // The store port guarantees no call ordering: if a fresh acquire overtakes
    // that release, the release lands afterwards and deletes the legitimately
    // re-acquired lease (same instance id) — local view says leader, key gone,
    // split-brain until the next heartbeat.
    service = new LeaderService(options, store);
    store.acquire.mockResolvedValueOnce(false); // stay follower at bootstrap
    await service.onModuleInit();

    let resolveAcquire!: (v: boolean) => void;
    store.acquire.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
    await vi.advanceTimersByTimeAsync(RETRY); // acquire #2 pending
    await service.stepDown();

    let resolveRelease!: (v: boolean) => void;
    store.release.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRelease = resolve)));
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0); // stale sweep: quiet release now pending
    store.acquire.mockResolvedValue(true);

    // When — the cooldown fully elapses while the release still hangs
    await vi.advanceTimersByTimeAsync(TTL + RETRY);

    // Then — candidacy is gated behind the pending release (no acquire #3)
    expect(store.acquire).toHaveBeenCalledTimes(2);

    // When — the release finally settles
    resolveRelease(true);
    await vi.advanceTimersByTimeAsync(0);

    // Then — the acquire goes out only now, and leadership is clean
    expect(store.acquire).toHaveBeenCalledTimes(3);
    expect(service.isLeader()).toBe(true);

    store.release.mockResolvedValue(true); // let the afterEach destroy finish
  });

  it('discards the tick when a stepDown supersedes it while it waits for a stale release, and survives every release failing', async () => {
    // Given — the same pending stale release, with the post-cooldown tick
    // suspended on it
    service = new LeaderService(options, store);
    store.acquire.mockResolvedValueOnce(false);
    await service.onModuleInit();

    let resolveAcquire!: (v: boolean) => void;
    store.acquire.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
    await vi.advanceTimersByTimeAsync(RETRY);
    await service.stepDown();

    const rejectReleases: Array<(e: Error) => void> = [];
    store.release.mockImplementation(() => new Promise<boolean>((_resolve, reject) => rejectReleases.push(reject)));
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0); // quiet release pending
    store.acquire.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(TTL + RETRY); // tick now awaits the release

    // When — a second stepDown supersedes the waiting tick (the wire-won
    // lease is still unconfirmed-released, so the stepDown RETRIES the
    // release), then every release FAILS on the wire
    const secondStepDown = service.stepDown();
    expect(rejectReleases).toHaveLength(2); // the stale one + the stepDown retry
    for (const reject of rejectReleases) {
      reject(new Error('wire down'));
    }
    await vi.advanceTimersByTimeAsync(0);
    await secondStepDown;

    // Then — the superseded tick acquires nothing (no candidacy during the
    // fresh cooldown), and the failed releases did not kill the loop
    expect(store.acquire).toHaveBeenCalledTimes(2);
    expect(service.isLeader()).toBe(false);

    // And — after the new cooldown the loop is still electing
    store.release.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(TTL + RETRY);
    expect(service.isLeader()).toBe(true);
  });

  it('must not let a stepDown release that outlives the cooldown be overtaken by the re-acquire', async () => {
    // Given — a leader whose stepDown release HANGS on the wire for longer
    // than the whole cooldown. If the post-cooldown re-acquire overtook it,
    // the release would land LAST and delete the legitimately re-acquired
    // lease (same instance id): local view says leader, key gone — another
    // instance takes the seat and the group splits until the next heartbeat.
    service = new LeaderService(options, store);
    await service.onModuleInit();
    expect(service.isLeader()).toBe(true);

    let resolveRelease!: (v: boolean) => void;
    store.release.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveRelease = resolve)));
    const stepDown = service.stepDown();
    await vi.advanceTimersByTimeAsync(0); // release now pending on the wire
    expect(service.isLeader()).toBe(false);
    store.acquire.mockClear();

    // When — the cooldown fully elapses while the release still hangs
    await vi.advanceTimersByTimeAsync(TTL + RETRY);

    // Then — candidacy stays gated behind the pending release: no acquire
    expect(store.acquire).not.toHaveBeenCalled();
    expect(service.isLeader()).toBe(false);

    // When — the release finally lands
    resolveRelease(true);
    await vi.advanceTimersByTimeAsync(0);
    await stepDown;

    // Then — the suspended tick re-acquires only now, and leadership is clean
    expect(store.acquire).toHaveBeenCalledTimes(1);
    expect(service.isLeader()).toBe(true);
  });

  it('must not wedge shutdown behind a release that cannot land — the awaits are bounded and the loss event still fires', async () => {
    // Given — a leader whose connection black-holes right at shutdown:
    // every release hangs forever (no driver command timeout)
    const onLost = vi.fn();
    service = new LeaderService({ ...options, onLost }, store);
    await service.onModuleInit();
    expect(service.isLeader()).toBe(true);
    store.release.mockImplementation(() => new Promise<boolean>(() => undefined));

    // When — the app shuts down
    const destroy = service.onModuleDestroy();
    let destroyed = false;
    void destroy.then(() => (destroyed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(destroyed).toBe(false); // waiting on the bounded release

    // Then — the release bound forfeits after one retry interval and the
    // loss event fires anyway (a wedged shutdown would also block every
    // later module's destroy hook behind this one)
    await vi.advanceTimersByTimeAsync(RETRY + 1);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith('default', 'shutdown');

    // And — the trailing release barrier is bounded the same way: destroy
    // completes instead of hanging until SIGKILL
    await vi.advanceTimersByTimeAsync(RETRY + 1);
    await destroy;
    expect(destroyed).toBe(true);

    store.release.mockResolvedValue(true); // let the afterEach destroy finish
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
