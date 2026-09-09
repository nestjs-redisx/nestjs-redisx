import { Injectable, Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { DEFAULT_LEADER_CONFIG, DEFAULT_LEADER_GROUP, LEADER_PLUGIN_OPTIONS, LEADER_STORE, MAX_LEADER_TTL_MS } from '../../../shared/constants';
import { ILeaderPluginOptions, LeaderLostReason } from '../../../shared/types';
import { generateInstanceId } from '../../../shared/utils/instance-id';
import { validateLeaderGroup, validateLeaderOptions } from '../../../shared/utils/validate-leader-options';
import { LeaderElectionState } from '../../domain/entities/leader-election-state';
import { getRegisteredLeaderGroups } from '../../api/decorators/leader-only.decorator';
import { ILeaderService } from '../ports/leader-service.port';
import { ILeaderStore } from '../ports/leader-store.port';

// Optional metrics integration (auto-wired when MetricsPlugin is present)
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
}

interface IElection {
  state: LeaderElectionState;
  timer: NodeJS.Timeout | null;
  stopped: boolean;
  /**
   * Incremented whenever the election's intent changes out-of-band
   * (stepDown, shutdown). A tick captures the epoch before awaiting the
   * store; a stale result — one that raced a supersession — must not mutate
   * state, fire events, or claim a lease nobody local acknowledges.
   */
  epoch: number;
  /**
   * Barrier over every own-lease release still on the wire (stale-sweep,
   * stepDown, shutdown). The store port guarantees no call ordering, so a
   * fresh acquire must wait for ALL of them — any release landing AFTER a
   * legitimate re-acquire would delete the new lease (same instance id) and
   * split-brain the group. The barrier covers SETTLEMENT ordering: a
   * release REJECTED client-side leaves the barrier even though a
   * transport replay may still land it — that residual is the documented
   * bounded-overlap tradeoff (self-heals within one heartbeat via CAS).
   */
  pendingRelease: Promise<void> | null;
  /**
   * The tick currently executing for this group, if any. Shutdown
   * rendezvouses with it (bounded): an acquire/renewal already on the wire
   * may WIN, and the win must be observed — and released — while the Redis
   * clients are still open, or a dead instance's lease blocks the group for
   * a full ttl.
   */
  inFlight: Promise<void> | null;
  /**
   * Fires when the confirmed lease reaches its deadline with no tick
   * observing it — the heartbeat is stuck on a store call (hung socket,
   * driver without a command timeout). The overdue onLost('expired') must
   * not wait minutes for that call to settle.
   */
  lapseTimer: NodeJS.Timeout | null;
}

/**
 * Lease-based leader election service.
 *
 * Runs one background election loop per group: while leader, the lease is
 * renewed every `renewIntervalMs` via a CAS script; while follower, an
 * acquire is attempted every `retryIntervalMs`. All store errors in the loop
 * are contained (logged; an unconfirmed lease simply demotes this instance) —
 * a background timer must never crash the application.
 */
@Injectable()
export class LeaderService implements ILeaderService, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderService.name);
  private readonly elections = new Map<string, IElection>();

  /** Groups already warned about in `isLeader` (one warning per group). */
  private readonly warnedUnknownGroups = new Set<string>();

  /** True once onModuleInit snapshotted the group registry and started elections. */
  private initialized = false;

  /** True once onModuleDestroy ran — a destroyed service never elects again. */
  private destroyed = false;

  readonly instanceId: string;

  private readonly keyPrefix: string;
  private readonly ttlMs: number;
  private readonly renewIntervalMs: number;
  private readonly retryIntervalMs: number;

  constructor(
    @Inject(LEADER_PLUGIN_OPTIONS)
    private readonly options: ILeaderPluginOptions,
    @Inject(LEADER_STORE)
    private readonly store: ILeaderStore,
    @Optional()
    @Inject(METRICS_SERVICE)
    private readonly metrics?: IMetricsService,
  ) {
    // The plugin validates too, but the service is exported for direct
    // construction (tests, custom wiring) — an invalid config like
    // renewIntervalMs >= ttlMs must fail fast on every path.
    validateLeaderOptions(options, 'LeaderService');
    this.instanceId = options.instanceId ?? generateInstanceId();
    this.keyPrefix = options.keyPrefix ?? DEFAULT_LEADER_CONFIG.keyPrefix;
    this.ttlMs = options.ttlMs ?? DEFAULT_LEADER_CONFIG.ttlMs;
    this.renewIntervalMs = options.renewIntervalMs ?? DEFAULT_LEADER_CONFIG.renewIntervalMs;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_LEADER_CONFIG.retryIntervalMs;
  }

  /**
   * Start elections for the default group, configured groups, and every group
   * registered by @LeaderOnly at decoration time. The first tick runs
   * immediately (awaited), so single-instance apps lead by the time the app
   * is up.
   */
  async onModuleInit(): Promise<void> {
    const groups = new Set<string>([DEFAULT_LEADER_GROUP, ...(this.options.groups ?? []), ...getRegisteredLeaderGroups()]);
    for (const group of groups) {
      if (this.destroyed) {
        // A destroy raced this init (aborted bootstrap, lifecycle misuse) —
        // a destroyed service must never start fresh election loops.
        return;
      }
      if (!this.elections.has(group)) {
        this.elections.set(group, { state: new LeaderElectionState(group), timer: null, stopped: false, epoch: 0, pendingRelease: null, inFlight: null, lapseTimer: null });
        await this.tick(group);
      }
    }
    this.initialized = true;
  }

  /**
   * Stop all loops and release every lease this instance holds — or may
   * still hold after a fail-safe local demotion — so failover is instant.
   */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    // First pass, fully synchronous: every loop is stopped and superseded
    // BEFORE the per-group teardown below yields to the event loop. Without
    // it, a not-yet-processed group's timer (or in-flight tick) could still
    // elect — and invoke the user's onElected — DURING shutdown.
    for (const election of this.elections.values()) {
      election.stopped = true;
      election.epoch += 1;
      this.clearTimers(election);
    }
    // Groups tear down CONCURRENTLY. Each one can burn up to three bounded
    // awaits (rendezvous, release, barrier), so draining them in sequence
    // would multiply the shutdown bound by the number of groups — with a
    // black-holed connection, a handful of groups is enough to outlast a
    // container's termination grace period and get the process SIGKILLed
    // mid-cleanup, which is exactly the wedge the bound exists to prevent.
    // Groups share nothing (own state, own key, own timers, own barrier),
    // and the synchronous stop pass above already ran, so nothing can elect
    // while a sibling group is releasing.
    await Promise.all([...this.elections].map(([group, election]) => this.destroyElection(group, election)));
    this.elections.clear();
  }

  /** Teardown of ONE group; contained so a sibling always gets released. */
  private async destroyElection(group: string, election: IElection): Promise<void> {
    try {
      if (election.inFlight) {
        // Rendezvous (bounded): an acquire/renewal already on the wire may
        // WIN; observing the result here — clients still open — lets the
        // release below clear it. A store call outliving the bound forfeits:
        // proceeding matches the pre-rendezvous best effort (quiet release
        // when it finally settles, ttl-bounded residue at worst).
        await this.awaitBounded(election.inFlight);
      }
      const now = Date.now();
      this.reconcileLapse(group, election, now);
      const wasLeader = election.state.isLeader(now);
      if (wasLeader) {
        election.state.lost();
      }
      if (wasLeader || election.state.mayHoldLease()) {
        // The key may still carry our id even when locally demoted (a
        // renewal ERROR demotes without confirming the seat is gone) — a
        // dead process's residue would block the group for the remaining
        // ttl. The release is CAS on our own id, so it can never touch a
        // seat somebody else already took. Bounded like the rendezvous
        // above: a release that cannot land on a hung connection must not
        // wedge the whole application shutdown chain behind it (the lease
        // then expires by ttl — the crash bound).
        await this.awaitBounded(this.trackRelease(group, election, `leadership of "${group}" on shutdown`));
      }
      if (wasLeader) {
        this.emitLost(group, 'shutdown');
      }
      if (election.pendingRelease) {
        // Every release — including quiet ones a stale tick fired — should
        // LAND before shutdown proceeds to closing the Redis clients: a
        // release still on the wire when they close is a lease nobody will
        // ever clear. Same bound, same forfeit.
        await this.awaitBounded(election.pendingRelease);
      }
    } catch (error) {
      // Unreachable through the shipped store (every await here is bounded
      // and contained), but one group must never abort the teardown of the
      // others — that would strand their leases for a full ttl.
      this.logger.warn(`Shutdown teardown of "${group}" failed: ${this.describeFailure(error)}`);
    }
  }

  isLeader(group: string = DEFAULT_LEADER_GROUP): boolean {
    validateLeaderGroup(group, 'isLeader');
    const election = this.elections.get(group);
    if (!election) {
      this.warnUnknownGroup(group);
      return false;
    }
    return election.state.isLeader(Date.now());
  }

  async getLeaderId(group: string = DEFAULT_LEADER_GROUP): Promise<string | null> {
    validateLeaderGroup(group, 'getLeaderId');
    return this.store.getHolder(this.buildKey(group));
  }

  async runIfLeader<T>(fn: () => T | Promise<T>, group: string = DEFAULT_LEADER_GROUP): Promise<T | undefined> {
    // Validate under THIS method's tag before delegating: the operator who
    // only ever calls runIfLeader must not be sent hunting for `isLeader`.
    validateLeaderGroup(group, 'runIfLeader');
    if (!this.isLeader(group)) {
      return undefined;
    }
    return await fn();
  }

  async stepDown(group: string = DEFAULT_LEADER_GROUP): Promise<void> {
    validateLeaderGroup(group, 'stepDown');
    const election = this.elections.get(group);
    if (!election) {
      return;
    }

    const now = Date.now();
    this.reconcileLapse(group, election, now);
    const wasLeader = election.state.isLeader(now);
    // Supersede any in-flight tick: its result must not resurrect or grant
    // leadership after this point.
    election.epoch += 1;
    // No lease to watch after a stepDown; the next elected() re-arms.
    this.clearLapseWatchdog(election);
    // Abstain from candidacy for one full ttl so another instance can win.
    election.state.startCooldown(now, this.ttlMs);

    if (wasLeader) {
      election.state.lost();
      // Emit at demotion time, like the 'expired' and 'shutdown' paths — NOT
      // after the release await: a release hanging on the wire while
      // onModuleDestroy supersedes this stepDown would otherwise fire the
      // user's onLost on a fully torn-down application (destroy stays silent
      // for this group — it reads wasLeader === false after lost() above).
      this.emitLost(group, 'stepdown');
    }
    if (wasLeader || election.state.mayHoldLease()) {
      // Also clears the residue of a fail-safe demotion (key still carrying
      // our id after a renewal error) — stepping down must actually free the
      // seat for the rest of the fleet. CAS on our own id: cannot touch a
      // seat held by another instance. Tracked: if this release outlives the
      // cooldown on the wire, the post-cooldown re-acquire must wait for it
      // (see `IElection.pendingRelease`).
      await this.trackRelease(group, election, `leadership of "${group}" on stepDown`);
    }
  }

  getGroups(): string[] {
    return [...this.elections.keys()];
  }

  /**
   * One election round for a group. Never throws: a background timer that
   * throws would crash the process. Tracked on the election as `inFlight`
   * so shutdown can rendezvous with a round already awaiting the store.
   */
  private tick(group: string): Promise<void> {
    const election = this.elections.get(group);
    if (!election || election.stopped) {
      return Promise.resolve();
    }
    const run = this.runTick(group, election);
    election.inFlight = run;
    const clear = (): void => {
      if (election.inFlight === run) {
        election.inFlight = null;
      }
    };
    run.then(clear, clear);
    return run;
  }

  private async runTick(group: string, election: IElection): Promise<void> {
    const key = this.buildKey(group);
    const now = Date.now();
    const epoch = election.epoch;

    // A lease that expired without any tick observing it (event-loop stall,
    // clock jump, store latency beyond ttl - renewInterval) must still report
    // its loss — otherwise the follow-up re-election fires a second
    // `onElected` with no `onLost` in between, and consumers that pair the
    // events to start/stop singleton workers double-start.
    this.reconcileLapse(group, election, now);

    if (election.state.isLeader(now)) {
      let renewed = false;
      let settled = false;
      try {
        renewed = await this.store.renew(key, this.instanceId, this.ttlMs);
        settled = true;
      } catch (error) {
        // Fail-safe: an unconfirmed lease is no lease. The key may still hold
        // our id, so the next follower tick re-claims it (store.acquire) and
        // a transient error costs at most one retry interval of leadership.
        this.logger.warn(`Lease renewal for "${group}" failed: ${(error as Error).message}`);
      }
      if (this.isStale(election, epoch)) {
        // A stepDown/shutdown superseded this round while the renewal was in
        // flight. If it still extended the remote lease, drop the key —
        // nobody local acknowledges it, and a held-but-unclaimed seat would
        // block failover for a full ttl. The wire result confirmed our id is
        // on the key, so record it: if the quiet release fails, a later
        // stepDown/shutdown retries instead of leaving dead residue.
        if (renewed) {
          election.state.confirmedHolder();
          this.releaseQuietly(group, election);
        }
        this.schedule(group, election);
        return;
      }
      if (renewed) {
        election.state.renewed(now, this.ttlMs);
        this.armLapseWatchdog(group, election);
      } else {
        election.state.lost();
        this.clearLapseWatchdog(election);
        if (settled) {
          // The store CONFIRMED the seat is not ours (vs. an error, where
          // the key may still carry our id and shutdown must clear it).
          election.state.confirmedNotHolder();
        }
        this.emitLost(group, 'expired');
      }
    } else if (!election.state.inCooldown(now)) {
      if (election.pendingRelease) {
        // Never overtake a stale release still on the wire: landing after a
        // fresh acquire, it would delete the new lease (same instance id).
        await election.pendingRelease;
        if (this.isStale(election, epoch)) {
          this.schedule(group, election);
          return;
        }
      }
      let acquired = false;
      let settled = false;
      try {
        acquired = await this.store.acquire(key, this.instanceId, this.ttlMs);
        settled = true;
      } catch (error) {
        this.logger.warn(`Leadership acquisition for "${group}" failed: ${(error as Error).message}`);
        // The rejection is client-side only — the SET NX may still have
        // been written and WON server-side. Without this pessimistic mark,
        // a stepDown/shutdown inside the retry window would skip its
        // release and a dead instance's zombie win would block the group
        // for a full ttl. The next settled answer corrects the flag.
        election.state.possiblyHolder();
      }
      if (this.isStale(election, epoch)) {
        if (acquired || !settled) {
          // Same residue tracking as the stale renewal above: a confirmed
          // win means the key carries our id until the quiet release
          // confirms otherwise — and an ERRORED acquire may have landed
          // and won too (possiblyHolder marked it in the catch), so
          // release that possible win as well instead of leaving it for
          // the fleet to wait out (a no-op CAS when nothing landed;
          // without it, a stepDown racing this tick would sit through its
          // whole cooldown with the zombie key blocking the group).
          if (acquired) {
            election.state.confirmedHolder();
          }
          this.releaseQuietly(group, election);
        }
        this.schedule(group, election);
        return;
      }
      if (acquired) {
        election.state.elected(now, this.ttlMs);
        this.armLapseWatchdog(group, election);
        this.emitElected(group);
      } else if (settled) {
        election.state.confirmedNotHolder();
      }
    }

    this.schedule(group, election);
  }

  /**
   * Report a passively-lapsed local lease (see the call sites): emits the
   * missing `onLost('expired')` so elected/lost stay strictly alternating.
   */
  private reconcileLapse(group: string, election: IElection, now: number): void {
    if (election.state.hasLapsed(now)) {
      election.state.lost();
      this.clearLapseWatchdog(election);
      this.emitLost(group, 'expired');
    }
  }

  /**
   * (Re)armed on every confirmed lease. Fires only when the deadline passes
   * with NO further confirmation — i.e. the heartbeat tick is stuck on a
   * store call (hung socket, driver without a command timeout). Consumers
   * pair elected/lost to start/stop singleton workers, so the overdue
   * onLost('expired') must fire on time even while that call dangles; the
   * stuck tick is superseded (epoch) so a late success cannot resurrect the
   * lease locally — if it still extended the key on the wire, the stale
   * sweep releases it.
   */
  private armLapseWatchdog(group: string, election: IElection): void {
    // A fresh clock read here is fine at the elected/renewed call sites:
    // should it land past the deadline (store call slower than the ttl),
    // the tick chain is provably alive there and reconciles the lapse
    // within one interval.
    this.armLapseWatchdogFor(group, election, election.state.lapsesInMs(Date.now()));
  }

  private armLapseWatchdogFor(group: string, election: IElection, remaining: number): void {
    this.clearLapseWatchdog(election);
    if (election.stopped || remaining <= 0) {
      return;
    }
    election.lapseTimer = setTimeout(
      () => {
        election.lapseTimer = null;
        if (election.stopped) {
          return;
        }
        const now = Date.now();
        if (!election.state.hasLapsed(now)) {
          // Spurious wake: timers run on the monotonic clock while the lease
          // deadline is wall-clock, so a clock stepped BACKWARD makes this
          // fire "early". Re-arm from the SAME clock read that said "not
          // lapsed" — a fresh read could already sit past the deadline (ms
          // boundary, GC pause between the two reads) and silently drop the
          // watchdog while the heartbeat is still hung, exactly what this
          // timer exists to cover.
          this.armLapseWatchdogFor(group, election, election.state.lapsesInMs(now));
          return;
        }
        election.epoch += 1;
        this.reconcileLapse(group, election, now);
        // Delay clamped: at the exact validation cap (ttl === MAX),
        // remaining + 1 would exceed Node's timer range and be set to 1 ms.
        // Firing at the deadline instead of 1 ms after is safe — the
        // callback acts only when hasLapsed() confirms.
      },
      Math.min(remaining + 1, MAX_LEADER_TTL_MS),
    );
    election.lapseTimer.unref?.();
  }

  private clearLapseWatchdog(election: IElection): void {
    if (election.lapseTimer) {
      clearTimeout(election.lapseTimer);
      election.lapseTimer = null;
    }
  }

  private clearTimers(election: IElection): void {
    if (election.timer) {
      clearTimeout(election.timer);
      election.timer = null;
    }
    this.clearLapseWatchdog(election);
  }

  /**
   * Await a shutdown-path promise for at most one `retryIntervalMs`.
   * The bound timer is cancelled either way — shutdown must leave no timer
   * behind. A never-rejecting input is assumed (all callers pass contained
   * promises).
   */
  private async awaitBounded(promise: Promise<unknown>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      // Deliberately NOT unref'd: this timer IS what guarantees shutdown
      // completes — with a dangling store promise and nothing else keeping
      // the event loop alive, an unref'd bound lets the process exit
      // mid-teardown before the forfeit fires. The finally below clears it,
      // so it can never outlive the await.
      timer = setTimeout(resolve, this.retryIntervalMs);
    });
    try {
      await Promise.race([promise, bound]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * A group with no running election answers `isLeader` with false FOREVER —
   * silently skipped singleton work is the worst failure mode of this plugin,
   * so make it loud (once per group). Typical cause: a `@LeaderOnly({ group })`
   * class loaded lazily AFTER bootstrap — its group missed the onModuleInit
   * registry snapshot. Suppressed before initialization (elections simply have
   * not started yet) — the scheduler only fires after init anyway.
   */
  private warnUnknownGroup(group: string): void {
    if (!this.initialized || this.warnedUnknownGroups.has(group)) {
      return;
    }
    this.warnedUnknownGroups.add(group);
    this.logger.warn(`isLeader("${group}"): no election is running for this group on this instance — always false. ` + `Add it to plugin options ("groups") or reference it from a @LeaderOnly decorator loaded before bootstrap; ` + `groups registered after startup (e.g. in a lazily loaded module) do not start an election. ` + `(Expected only if the application is shutting down.)`);
  }

  /**
   * True when the election was superseded (stepDown/shutdown) after the
   * given epoch was captured — results of awaits started before the
   * supersession must be discarded.
   */
  private isStale(election: IElection, epoch: number): boolean {
    return election.stopped || election.epoch !== epoch;
  }

  /**
   * Best-effort release of a lease this instance won or extended on the wire
   * after locally abandoning it. Tracked on the election so a future acquire
   * cannot overtake it (see `IElection.pendingRelease`).
   */
  private releaseQuietly(group: string, election: IElection): void {
    void this.trackRelease(group, election, `a stale lease of "${group}"`);
  }

  /**
   * Release this instance's (possible) lease, contained and tracked.
   *
   * - A settled call — deleted (true) or not-ours (false) — confirms the key
   *   no longer carried our id AS OF THE HOLD IT WAS ISSUED AGAINST
   *   (generation-guarded: a newer confirmed hold survives an older
   *   release's out-of-order settlement); a FAILED call keeps
   *   `mayHoldLease()` true so a later stepDown/shutdown retries instead of
   *   leaving dead residue.
   * - Every release joins the election's `pendingRelease` barrier: the store
   *   port guarantees no call ordering, and a release overtaken by a fresh
   *   own acquire would land afterwards and delete the new lease.
   *
   * Returns a promise for THIS release settling (never rejects), so
   * stepDown/shutdown can await their own release without being held up by
   * older ones still on the wire.
   */
  private trackRelease(group: string, election: IElection, subject: string): Promise<void> {
    // Captured at issue time: this release settling only proves the key no
    // longer carried the id AS OF the hold it was issued against. If a
    // NEWER hold is confirmed while it is on the wire (reordered own
    // acquire re-winning the key), its settlement must not clear the flag.
    const generation = election.state.currentHoldGeneration();
    const settled = this.store
      .release(this.buildKey(group), this.instanceId)
      .then(() => {
        election.state.confirmedNotHolder(generation);
      })
      .catch((error: Error) => {
        this.logger.warn(`Failed to release ${subject}: ${error.message}`);
      });
    const prior = election.pendingRelease;
    const pending = prior ? Promise.all([prior, settled]).then(() => undefined) : settled;
    election.pendingRelease = pending;
    void pending.then(() => {
      if (election.pendingRelease === pending) {
        election.pendingRelease = null;
      }
    });
    return settled;
  }

  private schedule(group: string, election: IElection): void {
    if (election.stopped) {
      return;
    }
    const delay = election.state.isLeader(Date.now()) ? this.renewIntervalMs : this.retryIntervalMs;
    election.timer = setTimeout(() => {
      this.tick(group).catch((error: Error) => {
        this.logger.error(`Election tick for "${group}" failed unexpectedly: ${error.message}`);
      });
    }, delay);
    election.timer.unref?.();
  }

  private emitElected(group: string): void {
    this.logger.log(`Instance "${this.instanceId}" became leader of "${group}"`);
    this.incrementCounterSafely('redisx_leader_elected_total', { group });
    this.fireCallback(() => this.options.onElected?.(group), 'onElected');
  }

  private emitLost(group: string, reason: LeaderLostReason): void {
    this.logger.log(`Instance "${this.instanceId}" lost leadership of "${group}" (${reason})`);
    this.incrementCounterSafely('redisx_leader_lost_total', { group, reason });
    this.fireCallback(() => this.options.onLost?.(group, reason), 'onLost');
  }

  /**
   * A user-supplied metrics implementation must never kill the election loop
   * (an uncaught throw here would end the setTimeout chain for the group).
   */
  private incrementCounterSafely(name: string, labels: Record<string, string>): void {
    try {
      this.metrics?.incrementCounter(name, labels);
    } catch (error) {
      this.logger.warn(`Metrics increment for "${name}" failed: ${this.describeFailure(error)}`);
    }
  }

  /**
   * Callbacks are fire-and-forget: a throwing listener must never break the
   * election loop or leave an unhandled rejection.
   */
  private fireCallback(fn: () => void | Promise<void>, name: string): void {
    try {
      Promise.resolve(fn()).catch((error: unknown) => {
        this.logger.warn(`${name} callback failed: ${this.describeFailure(error)}`);
      });
    } catch (error) {
      this.logger.warn(`${name} callback failed: ${this.describeFailure(error)}`);
    }
  }

  /**
   * User callbacks (and injected sinks) can fail with ANYTHING — a bare
   * `reject()` yields `undefined`. The containment handlers above must be
   * total: dereferencing `.message` here would mint a TypeError inside the
   * very guard that promises no rejection ever escapes — an
   * unhandledRejection crash on the async path, a dead election chain on
   * the sync one.
   */
  private describeFailure(error: unknown): string {
    try {
      return error instanceof Error ? error.message : String(error);
    } catch {
      return typeof error;
    }
  }

  private buildKey(group: string): string {
    return `${this.keyPrefix}${group}`;
  }
}
