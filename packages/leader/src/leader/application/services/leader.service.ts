import { Injectable, Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { DEFAULT_LEADER_CONFIG, DEFAULT_LEADER_GROUP, LEADER_PLUGIN_OPTIONS, LEADER_STORE } from '../../../shared/constants';
import { ILeaderPluginOptions, LeaderLostReason } from '../../../shared/types';
import { generateInstanceId } from '../../../shared/utils/instance-id';
import { validateLeaderGroup } from '../../../shared/utils/validate-leader-options';
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
      if (!this.elections.has(group)) {
        this.elections.set(group, { state: new LeaderElectionState(group), timer: null, stopped: false, epoch: 0 });
        await this.tick(group);
      }
    }
  }

  /**
   * Stop all loops and release held leases so failover is instant.
   */
  async onModuleDestroy(): Promise<void> {
    for (const [group, election] of this.elections) {
      election.stopped = true;
      election.epoch += 1;
      if (election.timer) {
        clearTimeout(election.timer);
        election.timer = null;
      }
      if (election.state.isLeader(Date.now())) {
        election.state.lost();
        await this.store.release(this.buildKey(group), this.instanceId).catch((error: Error) => {
          this.logger.warn(`Failed to release leadership of "${group}" on shutdown: ${error.message}`);
        });
        this.emitLost(group, 'shutdown');
      }
    }
    this.elections.clear();
  }

  isLeader(group: string = DEFAULT_LEADER_GROUP): boolean {
    validateLeaderGroup(group, 'isLeader');
    const election = this.elections.get(group);
    return election ? election.state.isLeader(Date.now()) : false;
  }

  async getLeaderId(group: string = DEFAULT_LEADER_GROUP): Promise<string | null> {
    validateLeaderGroup(group, 'getLeaderId');
    return this.store.getHolder(this.buildKey(group));
  }

  async runIfLeader<T>(fn: () => T | Promise<T>, group: string = DEFAULT_LEADER_GROUP): Promise<T | undefined> {
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
    const wasLeader = election.state.isLeader(now);
    // Supersede any in-flight tick: its result must not resurrect or grant
    // leadership after this point.
    election.epoch += 1;
    // Abstain from candidacy for one full ttl so another instance can win.
    election.state.startCooldown(now, this.ttlMs);

    if (wasLeader) {
      election.state.lost();
      await this.store.release(this.buildKey(group), this.instanceId).catch((error: Error) => {
        this.logger.warn(`Failed to release leadership of "${group}" on stepDown: ${error.message}`);
      });
      this.emitLost(group, 'stepdown');
    }
  }

  getGroups(): string[] {
    return [...this.elections.keys()];
  }

  /**
   * One election round for a group. Never throws: a background timer that
   * throws would crash the process.
   */
  private async tick(group: string): Promise<void> {
    const election = this.elections.get(group);
    if (!election || election.stopped) {
      return;
    }

    const key = this.buildKey(group);
    const now = Date.now();
    const epoch = election.epoch;

    if (election.state.isLeader(now)) {
      let renewed = false;
      try {
        renewed = await this.store.renew(key, this.instanceId, this.ttlMs);
      } catch (error) {
        // Fail-safe: an unconfirmed lease is no lease.
        this.logger.warn(`Lease renewal for "${group}" failed: ${(error as Error).message}`);
      }
      if (this.isStale(election, epoch)) {
        // A stepDown/shutdown superseded this round while the renewal was in
        // flight. If it still extended the remote lease, drop the key —
        // nobody local acknowledges it, and a held-but-unclaimed seat would
        // block failover for a full ttl.
        if (renewed) {
          this.releaseQuietly(group, key);
        }
        this.schedule(group, election);
        return;
      }
      if (renewed) {
        election.state.renewed(now, this.ttlMs);
      } else {
        election.state.lost();
        this.emitLost(group, 'expired');
      }
    } else if (!election.state.inCooldown(now)) {
      let acquired = false;
      try {
        acquired = await this.store.acquire(key, this.instanceId, this.ttlMs);
      } catch (error) {
        this.logger.warn(`Leadership acquisition for "${group}" failed: ${(error as Error).message}`);
      }
      if (this.isStale(election, epoch)) {
        if (acquired) {
          this.releaseQuietly(group, key);
        }
        this.schedule(group, election);
        return;
      }
      if (acquired) {
        election.state.elected(now, this.ttlMs);
        this.emitElected(group);
      }
    }

    this.schedule(group, election);
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
   * after locally abandoning it.
   */
  private releaseQuietly(group: string, key: string): void {
    this.store.release(key, this.instanceId).catch((error: Error) => {
      this.logger.warn(`Failed to release a stale lease of "${group}": ${error.message}`);
    });
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
      this.logger.warn(`Metrics increment for "${name}" failed: ${(error as Error).message}`);
    }
  }

  /**
   * Callbacks are fire-and-forget: a throwing listener must never break the
   * election loop or leave an unhandled rejection.
   */
  private fireCallback(fn: () => void | Promise<void>, name: string): void {
    try {
      Promise.resolve(fn()).catch((error: Error) => {
        this.logger.warn(`${name} callback failed: ${error.message}`);
      });
    } catch (error) {
      this.logger.warn(`${name} callback failed: ${(error as Error).message}`);
    }
  }

  private buildKey(group: string): string {
    return `${this.keyPrefix}${group}`;
  }
}
