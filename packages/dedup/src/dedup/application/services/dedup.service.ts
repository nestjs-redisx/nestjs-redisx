import { Injectable, Inject, Logger, Optional } from '@nestjs/common';

import { DEDUP_PLUGIN_OPTIONS, DEDUP_STORE, DEFAULT_DEDUP_CONFIG } from '../../../shared/constants';
import { DedupStoreError } from '../../../shared/errors';
import { IDedupPluginOptions, IDedupOptions, IDebounceOptions } from '../../../shared/types';
import { validateDedupCall, validateDedupOptions } from '../../../shared/utils/validate-dedup-options';
import { IDedupService } from '../ports/dedup-service.port';
import { IDedupStore } from '../ports/dedup-store.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
}

/**
 * Deduplication service implementation.
 *
 * First-wins markers with TTL windows (SET NX PX) and a distributed
 * trailing debounce whose execution is claimed atomically by the LAST
 * caller. Gates honor the errorPolicy; manual APIs are always strict.
 */
@Injectable()
export class DedupService implements IDedupService {
  private readonly logger = new Logger(DedupService.name);

  constructor(
    @Inject(DEDUP_PLUGIN_OPTIONS) private readonly config: IDedupPluginOptions,
    @Inject(DEDUP_STORE) private readonly store: IDedupStore,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {
    // The service is exported for direct wiring too - validate here as well
    // as in the plugin, so a hand-constructed service fails fast.
    validateDedupOptions(config, 'DedupService');
  }

  /**
   * First-occurrence check (strict API - store failures always throw).
   */
  async isFirst(key: string, options: IDedupOptions = {}): Promise<boolean> {
    validateDedupCall(key, options.window, 'isFirst');
    const fullKey = this.buildKey(key);
    const window = this.resolveWindow(options.window);

    let first: boolean;
    try {
      first = await this.store.markFirst(fullKey, this.generateToken(), window);
    } catch (error) {
      throw new DedupStoreError(key, error as Error);
    }

    this.quietly(() => this.metrics?.incrementCounter('redisx_dedup_checks_total', { outcome: first ? 'first' : 'duplicate' }));
    return first;
  }

  /**
   * Gate: run the function only for the first occurrence in the window.
   */
  async dedupe<T>(key: string, fn: () => Promise<T>, options: IDedupOptions = {}): Promise<T | undefined> {
    validateDedupCall(key, options.window, 'dedupe');
    const fullKey = this.buildKey(key);
    const window = this.resolveWindow(options.window);
    const token = this.generateToken();

    let first: boolean;
    try {
      first = await this.store.markFirst(fullKey, token, window);
    } catch (error) {
      return this.handleGateStoreFailure(key, fn, error);
    }

    this.quietly(() => this.metrics?.incrementCounter('redisx_dedup_checks_total', { outcome: first ? 'first' : 'duplicate' }));

    if (!first) {
      return undefined;
    }

    try {
      return await fn();
    } catch (error) {
      // A failed first execution must not burn the whole window: release
      // OUR marker (CAS on the token - a newer marker is never erased) so a
      // retry can run. Best effort AND total: a store that throws
      // synchronously or rejects with a nullish reason must never replace
      // the business error the caller is owed.
      try {
        await this.store.releaseIfOwner(fullKey, token);
      } catch (releaseError) {
        this.quietly(() => this.logger.warn(`dedupe("${key}"): failed to re-open the window after an error (retries stay blocked until the TTL): ${describeError(releaseError)}`));
      }
      throw error;
    }
  }

  /**
   * Distributed trailing debounce - the LAST caller in a quiet window
   * executes; everyone it superseded resolves to undefined.
   */
  async debounce<T>(key: string, fn: () => Promise<T>, options: IDebounceOptions = {}): Promise<T | undefined> {
    validateDedupCall(key, options.window, 'debounce');
    // NUL-delimited internal segment: user dedupe keys cannot contain \u0000
    // (validated above), so a user calling dedupe('debounce:x') can never
    // collide with the slot of debounce('x') - a plain 'debounce:' segment
    // let a plain SET stamp destroy a user's first-wins marker mid-window.
    const slotKey = this.buildKey(`\u0000debounce\u0000${key}`);
    const window = this.resolveWindow(options.window);
    const callId = this.generateToken();

    try {
      // Overwrite any previous caller: from now on, WE are the last call.
      // The slot outlives the window by a grace period so a claim never
      // races the key's own expiry. 5s: the local timer can fire late under
      // event-loop lag or a GC pause - a tighter grace silently DROPPED the
      // round (claim found the slot expired and nobody executed). A longer
      // slot costs nothing: new rounds overwrite it, and nothing else reads
      // it.
      await this.store.stampLastCall(slotKey, callId, window + 5_000);
    } catch (error) {
      // Fail-open here must still DEBOUNCE: running immediately would fire
      // with zero delay while a healthy instance stamps, waits, and runs the
      // round again. Wait the window first, then apply the policy.
      if ((this.config.errorPolicy ?? DEFAULT_DEDUP_CONFIG.errorPolicy) === 'fail-open') {
        await this.sleep(window);
      }
      return this.handleGateStoreFailure(key, fn, error);
    }

    // Local timer (unref'd): if this instance dies before the window
    // elapses, this round simply doesn't execute - same contract as an
    // in-process debounce.
    await this.sleep(window);

    let claim: 'claimed' | 'superseded' | 'expired';
    try {
      claim = await this.store.claimLastCall(slotKey, callId);
    } catch (error) {
      // The claim step is the ONE place fail-open must NOT run the function:
      // we may have been superseded, and running anyway duplicates the round
      // with stale arguments on top of the real winner's execution. Fail-open
      // degrades to skipping this round (loudly); fail-closed throws.
      if ((this.config.errorPolicy ?? DEFAULT_DEDUP_CONFIG.errorPolicy) === 'fail-closed') {
        throw new DedupStoreError(key, error instanceof Error ? error : undefined);
      }
      this.quietly(() => this.logger.warn(`debounce("${key}"): claim failed with the store unreachable - skipping this round (running a possibly-superseded round would duplicate the winner's execution): ${describeError(error)}`));
      return undefined;
    }

    if (claim === 'expired') {
      // The slot outlived its grace and vanished before we could claim it -
      // the process stalled (suspend, SIGSTOP, extreme lag). The round is
      // LOST, which must be loud: it is indistinguishable from supersession
      // only if nobody says anything.
      this.quietly(() => this.logger.warn(`debounce("${key}"): the debounce slot expired before this caller could claim it (process stalled past the ${window + 5_000}ms slot lifetime) - this round was lost.`));
      return undefined;
    }

    if (claim === 'superseded') {
      // A newer call superseded this one (or its timer already claimed).
      return undefined;
    }

    return fn();
  }

  /**
   * Manual marker removal (strict API - store failures always throw).
   */
  async release(key: string): Promise<boolean> {
    validateDedupCall(key, undefined, 'release');
    try {
      return await this.store.release(this.buildKey(key));
    } catch (error) {
      throw new DedupStoreError(key, error as Error);
    }
  }

  /**
   * Applies the errorPolicy when a GATE cannot reach the store:
   * 'fail-open' runs the function (duplicates possible, loudly logged),
   * 'fail-closed' throws DedupStoreError.
   */
  private async handleGateStoreFailure<T>(key: string, fn: () => Promise<T>, error: unknown): Promise<T> {
    const policy = this.config.errorPolicy ?? DEFAULT_DEDUP_CONFIG.errorPolicy;
    if (policy === 'fail-closed') {
      throw new DedupStoreError(key, error instanceof Error ? error : undefined);
    }
    // Total: a nullish rejection reason (bare reject()) must not break
    // fail-open at the precise moment it exists for - the store outage.
    this.quietly(() => this.logger.warn(`Dedup store unreachable for "${key}" - errorPolicy fail-open: executing WITHOUT deduplication (${describeError(error)})`));
    return fn();
  }

  /**
   * Containment for the user-extensible metrics implementation: a throwing
   * emit must never break dedup semantics - after markFirst succeeded, a
   * detonating counter would otherwise leave the event MARKED but never
   * handled (lost for the whole window).
   */
  private quietly<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  private buildKey(key: string): string {
    const prefix = this.config.keyPrefix ?? DEFAULT_DEDUP_CONFIG.keyPrefix;
    return `${prefix}${key}`;
  }

  private resolveWindow(window?: number): number {
    return window ?? this.config.defaultWindow ?? DEFAULT_DEDUP_CONFIG.defaultWindow;
  }

  private generateToken(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Never keep the process alive for a pending debounce window.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });
  }
}

/**
 * Total failure description: nullish and exotic rejection reasons must never
 * mint a TypeError inside a containment path.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return String(error);
  } catch {
    return typeof error;
  }
}
