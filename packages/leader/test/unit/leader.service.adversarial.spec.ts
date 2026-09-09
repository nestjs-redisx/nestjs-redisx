import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';
import { Logger } from '@nestjs/common';
import { LeaderService } from '../../src/leader/application/services/leader.service';
import type { ILeaderStore } from '../../src/leader/application/ports/leader-store.port';
import type { ILeaderPluginOptions } from '../../src/shared/types';
import { InvalidLeaderConfigError } from '../../src/shared/errors';
import { MAX_LEADER_TTL_MS } from '../../src/shared/constants';
import { clearRegisteredLeaderGroups } from '../../src/leader/api/decorators/leader-only.decorator';

const TTL = 15_000;
const RENEW = 5_000;
const RETRY = 2_000;
const KEY = 'leader:default';

interface ILease {
  holder: string;
  expiresAt: number;
}

/**
 * In-memory lease store with REAL semantics of the production store contract:
 * keyed leases, wall-clock expiry (driven by vi fake timers), CAS renew and
 * release, and the acquire-or-reclaim rule — acquire wins an empty seat OR
 * extends a lease this instance already holds, never one held by someone
 * else. Per-instance one-shot fault injection simulates transient Redis
 * errors seen by a single node.
 */
class FakeLeaseStore implements ILeaderStore {
  private readonly leases = new Map<string, ILease>();
  private readonly renewFaults = new Map<string, Error>();
  private readonly releaseFaults = new Map<string, Error>();
  private acquireGate: Promise<void> | null = null;
  private releaseGate: Promise<void> | null = null;
  private releasesBlackholed = false;
  private releaseAttempts = 0;

  failNextRenewFor(instanceId: string, error = new Error('transient redis error')): void {
    this.renewFaults.set(instanceId, error);
  }

  failNextReleaseFor(instanceId: string, error = new Error('transient redis error')): void {
    this.releaseFaults.set(instanceId, error);
  }

  /** Suspend the NEXT acquire on the wire; the returned function lands it. */
  holdNextAcquire(): () => void {
    let open!: () => void;
    this.acquireGate = new Promise<void>((resolve) => (open = resolve));
    return open;
  }

  /** Suspend the NEXT release on the wire; the returned function lands it. */
  holdNextRelease(): () => void {
    let open!: () => void;
    this.releaseGate = new Promise<void>((resolve) => (open = resolve));
    return open;
  }

  /** Black-hole EVERY release: they stay on the wire forever. */
  blackholeReleases(): void {
    this.releasesBlackholed = true;
  }

  releaseCalls(): number {
    return this.releaseAttempts;
  }

  holderOf(key: string): string | null {
    return this.current(key)?.holder ?? null;
  }

  async acquire(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    if (this.acquireGate) {
      const gate = this.acquireGate;
      this.acquireGate = null;
      await gate;
    }
    const lease = this.current(key);
    if (lease === null) {
      this.leases.set(key, { holder: instanceId, expiresAt: Date.now() + ttlMs });
      return true;
    }
    if (lease.holder === instanceId) {
      lease.expiresAt = Date.now() + ttlMs; // reclaim own lease
      return true;
    }
    return false;
  }

  async renew(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    const fault = this.renewFaults.get(instanceId);
    if (fault) {
      this.renewFaults.delete(instanceId);
      throw fault;
    }
    const lease = this.current(key);
    if (lease?.holder === instanceId) {
      lease.expiresAt = Date.now() + ttlMs;
      return true;
    }
    return false;
  }

  async release(key: string, instanceId: string): Promise<boolean> {
    this.releaseAttempts += 1;
    if (this.releasesBlackholed) {
      return new Promise<boolean>(() => undefined);
    }
    if (this.releaseGate) {
      const gate = this.releaseGate;
      this.releaseGate = null;
      await gate;
    }
    const fault = this.releaseFaults.get(instanceId);
    if (fault) {
      this.releaseFaults.delete(instanceId);
      throw fault;
    }
    const lease = this.current(key);
    if (lease?.holder === instanceId) {
      this.leases.delete(key);
      return true;
    }
    return false;
  }

  async getHolder(key: string): Promise<string | null> {
    return this.holderOf(key);
  }

  private current(key: string): ILease | null {
    const lease = this.leases.get(key);
    if (!lease) {
      return null;
    }
    if (Date.now() >= lease.expiresAt) {
      this.leases.delete(key);
      return null;
    }
    return lease;
  }
}

function makeOptions(instanceId: string, extra: Partial<ILeaderPluginOptions> = {}): ILeaderPluginOptions {
  return { instanceId, keyPrefix: 'leader:', ttlMs: TTL, renewIntervalMs: RENEW, retryIntervalMs: RETRY, ...extra };
}

describe('LeaderService — adversarial scenarios', () => {
  let services: LeaderService[];

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    clearRegisteredLeaderGroups();
    services = [];
  });

  afterEach(async () => {
    for (const service of services) {
      await service.onModuleDestroy();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function track(service: LeaderService): LeaderService {
    services.push(service);
    return service;
  }

  describe('self-lockout after an unconfirmed renewal (reclaim)', () => {
    it('recovers leadership within ONE retry interval after a transient renew error, instead of waiting out its own lease', async () => {
      // Given — a leader whose key sits in the store with a full ttl
      const store = new FakeLeaseStore();
      const onLost = vi.fn();
      const onElected = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost, onElected }), store));
      await service.onModuleInit();
      expect(service.isLeader()).toBe(true);

      // When — a single renewal fails with a transient error
      store.failNextRenewFor('node-1');
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then — fail-safe demotion (an unconfirmed lease is no lease)...
      expect(service.isLeader()).toBe(false);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');

      // ...while the key STILL holds this instance's id, so nobody else can win
      expect(store.holderOf(KEY)).toBe('node-1');
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(false);

      // And — the next follower tick re-claims the own lease: the leaderless
      // window is one retry interval, not the remaining ttl
      await vi.advanceTimersByTimeAsync(RETRY);
      expect(service.isLeader()).toBe(true);
      expect(onElected).toHaveBeenCalledTimes(2); // bootstrap + re-claim
      expect(store.holderOf(KEY)).toBe('node-1');
    });

    it('re-leads immediately after a restart with a stable instanceId (stale own lease from the previous run)', async () => {
      // Given — the previous process run left an unexpired lease behind
      const store = new FakeLeaseStore();
      await store.acquire(KEY, 'node-1', TTL);

      // When — the "restarted" process boots with the same instanceId
      const onElected = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onElected }), store));
      await service.onModuleInit();

      // Then — leader right away, no dead ttl window
      expect(service.isLeader()).toBe(true);
      expect(onElected).toHaveBeenCalledWith('default');
    });

    it('must NEVER steal a seat held by another instance', async () => {
      // Given — the seat belongs to node-2
      const store = new FakeLeaseStore();
      await store.acquire(KEY, 'node-2', TTL);
      const service = track(new LeaderService(makeOptions('node-1'), store));

      // When — bootstrap plus several follower retries
      await service.onModuleInit();
      await vi.advanceTimersByTimeAsync(RETRY * 3);

      // Then
      expect(service.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBe('node-2');
    });
  });

  describe('two competing instances over one store', () => {
    it('holds the at-most-one-leader invariant through error demotion, reclaim, stepDown, and takeover', async () => {
      // Given — two full election loops sharing one store
      const store = new FakeLeaseStore();
      const a = track(new LeaderService(makeOptions('node-a'), store));
      const b = track(new LeaderService(makeOptions('node-b'), store));

      const expectAtMostOneLeader = (): void => {
        expect(a.isLeader() && b.isLeader()).toBe(false);
      };

      await a.onModuleInit(); // first boot wins
      await b.onModuleInit();
      expect(a.isLeader()).toBe(true);
      expect(b.isLeader()).toBe(false);
      expectAtMostOneLeader();

      // When — A's renewal hits a transient error (A demotes, key stays A's)
      store.failNextRenewFor('node-a');
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(a.isLeader()).toBe(false);
      expectAtMostOneLeader();

      // Then — B keeps retrying but cannot take A's unexpired seat...
      await vi.advanceTimersByTimeAsync(RETRY - 1);
      expect(b.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBe('node-a');

      // ...and A re-claims its own lease on its next tick
      await vi.advanceTimersByTimeAsync(RETRY);
      expect(a.isLeader()).toBe(true);
      expect(b.isLeader()).toBe(false);
      expectAtMostOneLeader();

      // When — A voluntarily steps down (release + one-ttl cooldown)
      await a.stepDown();
      expectAtMostOneLeader();
      await vi.advanceTimersByTimeAsync(RETRY * 2);

      // Then — B takes the freed seat; A stays out through its cooldown
      expect(b.isLeader()).toBe(true);
      expect(a.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBe('node-b');
      expectAtMostOneLeader();

      // And — even after the cooldown, A cannot displace a live leader
      await vi.advanceTimersByTimeAsync(TTL + RETRY * 2);
      expect(b.isLeader()).toBe(true);
      expect(a.isLeader()).toBe(false);
      expectAtMostOneLeader();
    });
  });

  describe('in-flight renewal landing during shutdown', () => {
    it('rendezvouses with the pending renewal and releases the lease it extended, before shutdown completes', async () => {
      // Given — a leader whose renewal hangs (mock store for wire control)
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();

      let resolveRenew!: (v: boolean) => void;
      store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
      await vi.advanceTimersByTimeAsync(RENEW); // renewal now pending

      // When — shutdown starts while the renewal is still on the wire
      const destroy = service.onModuleDestroy();
      let destroyed = false;
      void destroy.then(() => (destroyed = true));
      await vi.advanceTimersByTimeAsync(0);

      // Then — shutdown WAITS for the wire result instead of racing it: a
      // release issued before the renewal settles could be overtaken, and a
      // renewal landing after the process died would strand the lease
      expect(destroyed).toBe(false);
      expect(store.release).not.toHaveBeenCalled();

      // When — the renewal SUCCEEDS on the wire (the lease was extended)
      resolveRenew(true);
      await vi.advanceTimersByTimeAsync(0);
      await destroy;

      // Then — the extended lease is released while the Redis clients are
      // still open, and only the shutdown loss event fired
      expect(store.release).toHaveBeenCalledWith(KEY, 'node-1');
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'shutdown');
    });
  });

  describe('async-rejecting lifecycle callbacks', () => {
    it('contains promise rejections from onLost/onElected and keeps the loop electing', async () => {
      // Given — callbacks that reject asynchronously (not throw synchronously)
      const store = new FakeLeaseStore();
      const onLost = vi.fn().mockRejectedValue(new Error('lost listener down'));
      const onElected = vi.fn().mockRejectedValue(new Error('elected listener down'));
      const service = track(new LeaderService(makeOptions('node-1', { onLost, onElected }), store));

      // When — elect, demote via a transient error, re-claim
      await service.onModuleInit();
      store.failNextRenewFor('node-1');
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(service.isLeader()).toBe(false);
      await vi.advanceTimersByTimeAsync(RETRY);

      // Then — every rejecting callback was invoked and the loop survived
      // (an unhandled rejection would fail this test run)
      expect(service.isLeader()).toBe(true);
      expect(onElected).toHaveBeenCalledTimes(2);
      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('contains a NULLISH rejection from onElected — a bare reject() must not crash the pod through the containment handler itself', async () => {
      // Given — the classic callback-bridge pattern rejects with no reason;
      // `.message` on undefined would mint a TypeError INSIDE the catch
      // handler, surfacing as an unhandledRejection on the pod that just won
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const store = new FakeLeaseStore();
        const onElected = vi.fn().mockRejectedValue(undefined);
        const service = track(new LeaderService(makeOptions('node-1', { onElected }), store));

        // When
        await service.onModuleInit();
        await vi.advanceTimersByTimeAsync(RENEW);

        // Then — elected, loop alive, failure described truthfully
        expect(service.isLeader()).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onElected callback failed: undefined'));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener('unhandledRejection', unhandled);
      }
    });

    it('contains a synchronous nullish THROW from onLost — the catch clause must not mint its own TypeError and kill the tick chain', async () => {
      // Given
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const store = new FakeLeaseStore();
      const onLost = vi.fn(() => {
        throw null;
      });
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();

      // When — a failed renewal demotes the leader and fires onLost
      store.failNextRenewFor('node-1');
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then — demotion completed and was described truthfully...
      expect(service.isLeader()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onLost callback failed: null'));

      // ...and the chain survived the escape-attempt: the next retry
      // re-claims (pre-fix the TypeError skipped schedule() — chain death)
      await vi.advanceTimersByTimeAsync(RETRY);
      expect(service.isLeader()).toBe(true);
    });

    it('tags runIfLeader group validation with its OWN name — the operator called runIfLeader, not isLeader', async () => {
      // Given
      const store = new FakeLeaseStore();
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();

      // When/Then
      await expect(service.runIfLeader(async () => 'x', 123 as never)).rejects.toThrow(InvalidLeaderConfigError);
      await expect(service.runIfLeader(async () => 'x', 123 as never)).rejects.toThrow(/runIfLeader: group/);
    });
  });

  describe('stepDown superseded by shutdown', () => {
    it('must not fire onLost AFTER onModuleDestroy resolves when the stepDown release hangs on the wire', async () => {
      // Given — a leader whose stepDown release will outhang the bounded
      // shutdown rendezvous
      const store = new FakeLeaseStore();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();
      const land = store.holdNextRelease();

      // When — stepDown demotes; the loss event fires at DEMOTION time, not
      // at release-settlement time
      const stepDown = service.stepDown();
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'stepdown');

      // And — shutdown supersedes while that release still hangs; destroy
      // stays silent for this group (wasLeader already false) and forfeits
      // the barrier after one bounded retry interval
      const destroy = service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(RETRY + 1);
      await destroy;
      const emitsWhenDestroyResolved = onLost.mock.calls.length;

      // Then — the release finally landing on the torn-down application
      // must run NO user callbacks (pre-fix: onLost('stepdown') fired here)
      land();
      await vi.advanceTimersByTimeAsync(1);
      await stepDown;
      expect(onLost.mock.calls.length).toBe(emitsWhenDestroyResolved);
      expect(onLost).toHaveBeenCalledTimes(1); // exactly one loss event — alternation intact
    });
  });

  describe('construction-time validation (direct wiring, no plugin)', () => {
    it('rejects a heartbeat that cannot outrun its own lease', () => {
      // When/Then — renewIntervalMs >= ttlMs would flap on every heartbeat
      expect(() => new LeaderService(makeOptions('node-1', { ttlMs: 5_000, renewIntervalMs: 5_000 }), new FakeLeaseStore())).toThrow(InvalidLeaderConfigError);
    });

    it('rejects non-integer intervals and an empty instanceId', () => {
      // When/Then
      expect(() => new LeaderService(makeOptions('node-1', { ttlMs: 0.5 }), new FakeLeaseStore())).toThrow(InvalidLeaderConfigError);
      expect(() => new LeaderService(makeOptions('node-1', { instanceId: '   ' }), new FakeLeaseStore())).toThrow(InvalidLeaderConfigError);
    });
  });

  describe('shutdown/stepDown with a locally-demoted but still-held lease (residue)', () => {
    it('releases the still-held key on graceful shutdown after a transient-error demotion, so failover is instant', async () => {
      // Given — a leader demoted by a transient renewal error: locally a
      // follower, but the key STILL carries this instance's id
      const store = new FakeLeaseStore();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();
      store.failNextRenewFor('node-1');
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(service.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBe('node-1');

      // When — the app shuts down gracefully before the reclaim tick
      await service.onModuleDestroy();

      // Then — the residue is cleared: another instance wins immediately
      // instead of waiting out the dead process's lease for up to a full ttl
      expect(store.holderOf(KEY)).toBeNull();
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(true);

      // And — only the earlier 'expired' loss fired; a non-leader shutdown
      // adds no 'shutdown' event
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
    });

    it('releases the still-held key on stepDown after a transient-error demotion', async () => {
      // Given — the same demoted-but-still-holder state
      const store = new FakeLeaseStore();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();
      store.failNextRenewFor('node-1');
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(store.holderOf(KEY)).toBe('node-1');

      // When — the operator steps this instance down (e.g. pre-maintenance)
      await service.stepDown();

      // Then — the seat is actually freed for the rest of the fleet
      expect(store.holderOf(KEY)).toBeNull();
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(true);

      // And — no bogus 'stepdown' loss on top of the earlier 'expired' one
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
    });

    it('skips the shutdown release when the store already confirmed the seat is not ours', async () => {
      // Given — a renewal REJECTED by the store (returned false): the store
      // itself confirmed this instance no longer holds the key
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      store.renew.mockResolvedValueOnce(false);
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(service.isLeader()).toBe(false);
      store.acquire.mockResolvedValue(false); // someone else leads now
      await vi.advanceTimersByTimeAsync(RETRY);

      // When
      await service.onModuleDestroy();

      // Then — no wasted release round-trip for a confirmed non-holder
      expect(store.release).not.toHaveBeenCalled();
    });
  });

  describe('wire-won stale lease whose quiet release fails (residue tracking)', () => {
    it('retries the release on shutdown, so a lease won by a superseded acquire cannot block failover for a full ttl', async () => {
      // Given — node-0 holds the seat and node-1 follows; node-1's next
      // acquire attempt hangs on the wire
      const store = new FakeLeaseStore();
      await store.acquire(KEY, 'node-0', TTL);
      const onElected = vi.fn();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onElected, onLost }), store));
      await service.onModuleInit();
      expect(service.isLeader()).toBe(false);

      await vi.advanceTimersByTimeAsync(TTL - RETRY);
      const landAcquire = store.holdNextAcquire();
      await vi.advanceTimersByTimeAsync(RETRY); // acquire in flight; node-0's lease is expiring

      // When — a stepDown supersedes the in-flight acquire, which then WINS
      // on the wire (node-0's lease just expired), and the best-effort quiet
      // release of that unwanted lease FAILS
      await service.stepDown();
      store.failNextReleaseFor('node-1');
      landAcquire();
      await vi.advanceTimersByTimeAsync(0);

      // Then — the key carries node-1's id with nobody local claiming it:
      // the rest of the fleet is locked out
      expect(service.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBe('node-1');
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(false);

      // When — the app shuts down gracefully
      await service.onModuleDestroy();

      // Then — shutdown KNOWS the wire-win may still be held and retries the
      // release: the seat is freed instantly instead of after a full ttl
      expect(store.holderOf(KEY)).toBeNull();
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(true);

      // And — node-1 never locally led, so no election events fired at all
      expect(onElected).not.toHaveBeenCalled();
      expect(onLost).not.toHaveBeenCalled();
    });

    it('clears the residue flag when the quiet release settles, so shutdown does not issue a redundant release', async () => {
      // Given — the same superseded wire-win, but the quiet release SUCCEEDS
      const store = new FakeLeaseStore();
      await store.acquire(KEY, 'node-0', TTL);
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();

      await vi.advanceTimersByTimeAsync(TTL - RETRY);
      const landAcquire = store.holdNextAcquire();
      await vi.advanceTimersByTimeAsync(RETRY);
      await service.stepDown();
      landAcquire();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.holderOf(KEY)).toBeNull(); // quiet release freed the seat

      // When — the app shuts down after the confirmed release
      const releaseSpy = vi.spyOn(store, 'release');
      await service.onModuleDestroy();

      // Then — nothing left to clean up: no extra release round-trip
      expect(releaseSpy).not.toHaveBeenCalled();
    });
  });

  describe('passive lease lapse (event-loop stall / clock jump)', () => {
    it('emits onLost(expired) before re-electing when the local lease lapsed without a tick observing it', async () => {
      // Given — an elected leader
      const T0 = 1_700_000_000_000;
      const store = new FakeLeaseStore();
      const onLost = vi.fn();
      const onElected = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost, onElected }), store));
      await service.onModuleInit();
      expect(onElected).toHaveBeenCalledTimes(1);

      // When — the event loop stalls past the whole ttl (wall clock moves,
      // no timer fires), then the overdue heartbeat tick finally runs
      vi.setSystemTime(T0 + TTL + 5_000);
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then — the lapse is reported before the re-election, keeping
      // elected/lost strictly alternating (consumers pair them to start/stop
      // singleton workers)
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
      expect(onElected).toHaveBeenCalledTimes(2);
      expect(onLost.mock.invocationCallOrder[0]).toBeGreaterThan(onElected.mock.invocationCallOrder[0]);
      expect(onLost.mock.invocationCallOrder[0]).toBeLessThan(onElected.mock.invocationCallOrder[1]);
      expect(service.isLeader()).toBe(true);
    });
  });

  describe('lifecycle misuse', () => {
    it('stays dead after destroy: a late onModuleInit must not restart elections', async () => {
      // Given — a fully started and then destroyed service
      const store = new FakeLeaseStore();
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      await service.onModuleDestroy();

      // When — a stray init lands after destroy (destroy racing a slow init,
      // or manual lifecycle misuse)
      await service.onModuleInit();

      // Then — no elections, no lease, no timers on a destroyed service
      expect(service.getGroups()).toEqual([]);
      expect(service.isLeader()).toBe(false);
      expect(store.holderOf(KEY)).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('lapse watchdog: heartbeat stuck on a hung store call', () => {
    it("emits onLost('expired') on time while the renewal still dangles, and discards the late success", async () => {
      // Given — a leader whose renewal HANGS (black-holed socket, driver
      // without a command timeout): the tick chain is suspended, so no tick
      // can observe the lapse
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const onLost = vi.fn();
      const onElected = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost, onElected }), store));
      await service.onModuleInit();
      expect(onElected).toHaveBeenCalledTimes(1);

      let resolveRenew!: (v: boolean) => void;
      store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
      await vi.advanceTimersByTimeAsync(RENEW); // renewal now pending forever

      // When — the rest of the ttl elapses with no wire answer
      await vi.advanceTimersByTimeAsync(TTL - RENEW + 2);

      // Then — the loss event fires ON TIME: consumers pair elected/lost to
      // start/stop singleton workers, and a stop signal delayed until the
      // hung call settles (minutes) would run two workers concurrently
      expect(service.isLeader()).toBe(false);
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');

      // When — the hung renewal finally SUCCEEDS on the wire much later
      resolveRenew(true);
      await vi.advanceTimersByTimeAsync(0);

      // Then — the late success cannot resurrect local leadership, and the
      // lease it extended on the wire is quietly released
      expect(service.isLeader()).toBe(false);
      expect(onElected).toHaveBeenCalledTimes(1);
      expect(store.release).toHaveBeenCalledWith(KEY, 'node-1');

      // And — the loop is alive: candidacy resumes on the next retry tick
      await vi.advanceTimersByTimeAsync(RETRY + 1);
      expect(service.isLeader()).toBe(true);
      expect(onElected).toHaveBeenCalledTimes(2);
    });
  });

  describe('lapse watchdog: wall clock stepping backward', () => {
    it('re-arms after a spurious wake and still emits the overdue loss when the deadline truly passes', async () => {
      // Given — a leader whose renewal hangs; the watchdog is the only
      // thing left that can report the lapse
      const T0 = 1_700_000_000_000;
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();
      let resolveRenew!: (v: boolean) => void;
      store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
      await vi.advanceTimersByTimeAsync(RENEW); // renewal pending forever

      // When — the wall clock steps BACK 30s (timers keep monotonic time),
      // so the watchdog wakes at the timer deadline but the wall-clock
      // lease has not lapsed yet
      vi.setSystemTime(T0 + RENEW - 30_000);
      await vi.advanceTimersByTimeAsync(TTL - RENEW + 2);

      // Then — a spurious wake must not emit anything...
      expect(onLost).not.toHaveBeenCalled();

      // ...and must NOT silently drop the watchdog: when the wall clock
      // finally reaches the deadline, the re-armed watchdog reports the
      // loss (a dropped watchdog would stay silent until the hung socket
      // died, minutes later)
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
      expect(service.isLeader()).toBe(false);

      // Cleanup — let the hung renewal settle so the afterEach destroy
      // has nothing pending
      resolveRenew(false);
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe('lapse watchdog: clock advancing between the wake read and the re-arm', () => {
    it('re-arms from the SAME clock read — a fresh read past the deadline must not silently drop the watchdog', async () => {
      // Given — a leader whose renewal hangs; the watchdog is the only
      // live timer for the group
      const T0 = 1_700_000_000_000;
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onLost }), store));
      await service.onModuleInit();
      let resolveRenew!: (v: boolean) => void;
      store.renew.mockImplementation(() => new Promise<boolean>((resolve) => (resolveRenew = resolve)));
      await vi.advanceTimersByTimeAsync(RENEW); // renewal pending forever
      await vi.advanceTimersByTimeAsync(TTL - RENEW - 5); // just before the deadline

      // When — the watchdog wakes reading a clock 2ms BEFORE the deadline,
      // but any LATER read already sits past it (ms boundary / GC pause
      // between two adjacent reads)
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(T0 + TTL - 2);
      nowSpy.mockReturnValue(T0 + TTL + 5);
      await vi.advanceTimersByTimeAsync(6); // watchdog fires its spurious wake
      nowSpy.mockRestore();

      // Then — the watchdog is STILL armed (a re-arm decided by a fresh
      // read would have seen remaining <= 0 and silently dropped it, with
      // the heartbeat hung and nothing left to emit the loss)
      expect(onLost).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // When — the re-armed watchdog reaches the true deadline
      await vi.advanceTimersByTimeAsync(5);

      // Then — the overdue loss fires
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
      expect(service.isLeader()).toBe(false);

      // Cleanup — settle the hung renewal for the afterEach destroy
      resolveRenew(false);
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe('shutdown while a follower acquire is in flight (rolling restart)', () => {
    it('rendezvouses with the wire-win during destroy and frees the seat before the process goes away', async () => {
      // Given — node-0 leads; node-1 follows, and node-1's next acquire is
      // held on the wire exactly while node-0's lease expires
      const store = new FakeLeaseStore();
      await store.acquire(KEY, 'node-0', TTL);
      const onElected = vi.fn();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { onElected, onLost }), store));
      await service.onModuleInit();
      await vi.advanceTimersByTimeAsync(TTL - RETRY);
      const landAcquire = store.holdNextAcquire();
      await vi.advanceTimersByTimeAsync(RETRY); // acquire in flight

      // When — this instance shuts down while the acquire is still out
      const destroy = service.onModuleDestroy();
      let destroyed = false;
      void destroy.then(() => (destroyed = true));
      await vi.advanceTimersByTimeAsync(0);

      // Then — destroy waits for the wire result instead of racing it: a
      // win landing after the process (and its Redis clients) are gone
      // would strand a dead instance's lease for a full ttl
      expect(destroyed).toBe(false);

      // When — the acquire lands and WINS (node-0's lease just expired)
      landAcquire();
      await vi.advanceTimersByTimeAsync(0);
      await destroy;

      // Then — the seat is freed before shutdown completes: the next
      // instance wins immediately instead of waiting out a dead process
      expect(store.holderOf(KEY)).toBeNull();
      expect(await store.acquire(KEY, 'node-2', TTL)).toBe(true);
      expect(onElected).not.toHaveBeenCalled();
      expect(onLost).not.toHaveBeenCalled();
    });
  });

  describe('errored acquire that may have landed (client-side rejection after the write)', () => {
    it('releases on shutdown after an ERRORED acquire — the SET NX may have won server-side', async () => {
      // Given — a follower whose acquire REJECTS client-side (command
      // deadline after the command left): the write may still have landed
      // and won on a just-freed seat
      const store = {
        acquire: vi.fn().mockResolvedValueOnce(false),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      store.acquire.mockRejectedValueOnce(new Error('command timed out'));
      await vi.advanceTimersByTimeAsync(RETRY);

      // When — the app shuts down inside the retry window
      await service.onModuleDestroy();

      // Then — the possible zombie win is released (a no-op CAS when
      // nothing landed); previously nothing marked the possibility and the
      // dead instance's key blocked the group for a full ttl
      expect(store.release).toHaveBeenCalledWith(KEY, 'node-1');
    });

    it('quiet-releases the possible win when a stepDown supersedes an ERRORING acquire, instead of trapping it through the cooldown', async () => {
      // Given — a follower whose acquire is in flight when stepDown runs
      const store = {
        acquire: vi.fn().mockResolvedValueOnce(false),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      let rejectAcquire!: (e: Error) => void;
      store.acquire.mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => (rejectAcquire = reject)));
      await vi.advanceTimersByTimeAsync(RETRY); // acquire pending

      // When — stepDown supersedes it (holding=false, so no stepDown
      // release), then the acquire ERRORS client-side — the SET NX may
      // still have landed and won
      await service.stepDown();
      rejectAcquire(new Error('command timed out'));
      await vi.advanceTimersByTimeAsync(0);

      // Then — the stale sweep releases the POSSIBLE win right away (a
      // no-op CAS if nothing landed) instead of letting a zombie key block
      // the fleet through this instance's entire cooldown
      expect(store.release).toHaveBeenCalledWith(KEY, 'node-1');
    });

    it('clears the pessimistic mark when the next acquire settles false, so shutdown issues no redundant release', async () => {
      // Given — the same errored acquire, then a SETTLED false answer
      const store = {
        acquire: vi.fn().mockResolvedValueOnce(false),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      store.acquire.mockRejectedValueOnce(new Error('command timed out'));
      await vi.advanceTimersByTimeAsync(RETRY);
      store.acquire.mockResolvedValueOnce(false); // store CONFIRMS: not ours
      await vi.advanceTimersByTimeAsync(RETRY);

      // When
      await service.onModuleDestroy();

      // Then
      expect(store.release).not.toHaveBeenCalled();
    });
  });

  describe('out-of-order release settlement vs a newer wire-won hold', () => {
    it('keeps the residue flag when an OLDER release settles after a newer own acquire won the key, so shutdown still retries the release', async () => {
      // Given — a leader demoted by a renewal ERROR: locally follower, key
      // still carries our id (holding = true)
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1'), store));
      await service.onModuleInit();
      store.renew.mockRejectedValueOnce(new Error('transient'));
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(service.isLeader()).toBe(false);

      // And — the next follower acquire is in flight (it will re-claim the
      // own residue id)
      let resolveAcquire!: (v: boolean) => void;
      store.acquire.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveAcquire = resolve)));
      await vi.advanceTimersByTimeAsync(RETRY);

      // When — stepDown issues release #1 (pending), then the acquire WINS
      // on the wire (release #1 deleted the OLD residue server-side first;
      // the fresh SET NX re-won the key), then #1's delayed ack arrives,
      // then the quiet release #2 of the wire-win FAILS
      let resolveRelease1!: (v: boolean) => void;
      let rejectRelease2!: (e: Error) => void;
      store.release.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveRelease1 = resolve)));
      store.release.mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => (rejectRelease2 = reject)));
      const stepDown = service.stepDown();
      resolveAcquire(true);
      await vi.advanceTimersByTimeAsync(0); // stale path: confirmedHolder + quiet release #2
      resolveRelease1(true);
      await vi.advanceTimersByTimeAsync(0); // OLD release settles AFTER the newer hold
      rejectRelease2(new Error('wire down'));
      await vi.advanceTimersByTimeAsync(0);
      await stepDown;

      // Then — the key still carries our id and nobody local claims it;
      // shutdown MUST retry the release (an unguarded confirmedNotHolder
      // from #1 would have cleared the flag and shutdown would skip it,
      // leaving a dead lease blocking the group for a full ttl)
      store.release.mockResolvedValue(true);
      await service.onModuleDestroy();
      expect(store.release).toHaveBeenCalledTimes(3);
      expect(store.release).toHaveBeenLastCalledWith(KEY, 'node-1');
    });
  });

  describe('lapse watchdog at the maximum ttl', () => {
    it('never asks the timer subsystem for a delay beyond the JS timer range', async () => {
      // Given — the largest ttl validation accepts; the watchdog arms with
      // remaining + 1, which would overflow Node's setTimeout cap and be
      // clamped to 1 ms (spurious immediate wake + a process warning)
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const store = {
        acquire: vi.fn().mockResolvedValue(true),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const service = track(new LeaderService(makeOptions('node-1', { ttlMs: MAX_LEADER_TTL_MS }), store));

      // When — election confirms a lease of exactly the cap
      await service.onModuleInit();
      await vi.advanceTimersByTimeAsync(RENEW); // one renewal re-arms it too

      // Then — every scheduled delay fits the timer range
      const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay as number);
      expect(delays.length).toBeGreaterThan(0);
      expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_LEADER_TTL_MS);
      setTimeoutSpy.mockRestore();
    });
  });

  describe('multi-group shutdown', () => {
    it('never elects a later group while destroy is busy releasing an earlier one', async () => {
      // Given — leader of "default"; follower of "jobs" whose second
      // acquire hangs on the wire
      let jobsAcquires = 0;
      let resolveJobsAcquire!: (v: boolean) => void;
      const store = {
        acquire: vi.fn((key: string) => {
          if (key === 'leader:default') {
            return Promise.resolve(true);
          }
          jobsAcquires += 1;
          if (jobsAcquires === 1) {
            return Promise.resolve(false);
          }
          return new Promise<boolean>((resolve) => (resolveJobsAcquire = resolve));
        }),
        renew: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        getHolder: vi.fn().mockResolvedValue(null),
      } as unknown as MockedObject<ILeaderStore>;
      const onElected = vi.fn();
      const onLost = vi.fn();
      const service = track(new LeaderService(makeOptions('node-1', { groups: ['jobs'], onElected, onLost }), store));
      await service.onModuleInit();
      expect(onElected).toHaveBeenCalledTimes(1); // default only
      await vi.advanceTimersByTimeAsync(RETRY); // jobs acquire #2 now pending

      // When — shutdown starts; while it releases "default", the pending
      // "jobs" acquire WINS on the wire
      const destroy = service.onModuleDestroy();
      resolveJobsAcquire(true);
      await vi.advanceTimersByTimeAsync(0);
      await destroy;

      // Then — the destroyed service never elected "jobs" (no onElected
      // during shutdown), and the wire-won seat was released
      expect(onElected).toHaveBeenCalledTimes(1);
      expect(store.release).toHaveBeenCalledWith('leader:jobs', 'node-1');
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith('default', 'shutdown');
      expect(service.isLeader('jobs')).toBe(false);
    });

    it('bounds the WHOLE shutdown, not one group at a time — a black-holed connection must not multiply the wait by the group count', async () => {
      // Given — four elections (default + three), every one of them a
      // leader, and a connection that swallows every release
      const store = new FakeLeaseStore();
      const service = track(new LeaderService(makeOptions('node-1', { groups: ['reports', 'cleanup', 'billing'] }), store));
      await service.onModuleInit();
      expect(service.getGroups()).toHaveLength(4);
      expect(service.isLeader('billing')).toBe(true);
      store.blackholeReleases();

      // When — shutdown forfeits its bounded awaits (release, then barrier)
      let settled = false;
      const destroy = service.onModuleDestroy().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(RETRY * 2 + 10);

      // Then — done after TWO forfeits total, not two per group: draining
      // groups in sequence would need eight here, outlasting a container's
      // termination grace period and getting the process SIGKILLed
      // mid-cleanup — the very wedge the bound exists to prevent
      expect(settled).toBe(true);
      await destroy;
      expect(store.releaseCalls()).toBe(4); // every group still attempted its release
    });
  });

  describe('groups without a running election', () => {
    it('warns ONCE per group when isLeader is asked about a group whose election never started', async () => {
      // Given
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      const service = track(new LeaderService(makeOptions('node-1'), new FakeLeaseStore()));
      const unknownGroupWarnings = (): number => warnSpy.mock.calls.filter(([message]) => typeof message === 'string' && message.includes('no election is running')).length;

      // When — consulted BEFORE init (elections simply not started yet)
      expect(service.isLeader('late-group')).toBe(false);

      // Then — no noise during bootstrap
      expect(unknownGroupWarnings()).toBe(0);

      // When — after init, a group registered too late (e.g. a lazily loaded
      // @LeaderOnly class) is consulted repeatedly
      await service.onModuleInit();
      expect(service.isLeader('late-group')).toBe(false);
      expect(service.isLeader('late-group')).toBe(false);
      expect(service.isLeader('other-late-group')).toBe(false);

      // Then — the silent-forever-skip is loud: one warning per group
      expect(unknownGroupWarnings()).toBe(2);
    });
  });
});
