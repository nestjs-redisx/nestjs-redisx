import { CircuitState, ICircuitBreakerConfig, ICircuitBreakerState, ICircuitSnapshot } from './circuit-breaker-state.interface';
import { validateCircuitBreakerConfig } from './validate-circuit-breaker-config';

/**
 * Pure, time-injected circuit-breaker finite state machine.
 *
 * No I/O and no `Date.now()`: every time-dependent method receives an explicit
 * `now` (epoch ms). See {@link ICircuitBreakerState} for the authoritative
 * transition semantics — this class implements them verbatim.
 */
export class CircuitBreakerState implements ICircuitBreakerState {
  private state: CircuitState = 'closed';

  /** CLOSED: timestamps (epoch ms) of recorded failures, pruned by the window. */
  private failures: number[] = [];

  /** OPEN: the time the breaker entered OPEN. */
  private openedAt = 0;

  /** HALF_OPEN: successful probes recorded so far. */
  private halfOpenSuccesses = 0;

  /**
   * HALF_OPEN: start timestamps (epoch ms, ascending) of permitted probes that
   * have not resolved yet. A probe whose start time is <= now - probeTimeoutMs
   * is expired and its slot is reclaimed.
   */
  private halfOpenProbes: number[] = [];

  constructor(private readonly config: ICircuitBreakerConfig) {
    validateCircuitBreakerConfig(config);
  }

  canRequest(now: number): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        // Commit OPEN -> HALF_OPEN only here, never in snapshot().
        if (now - this.openedAt >= this.config.openDurationMs) {
          this.state = 'half-open';
          this.halfOpenSuccesses = 0;
          this.halfOpenProbes = [];
          return this.tryHalfOpenProbe(now);
        }
        return false;

      case 'half-open':
        return this.tryHalfOpenProbe(now);
    }
  }

  recordSuccess(now: number): void {
    switch (this.state) {
      case 'closed':
        // No-op: window aging alone clears failures; success does not reset it.
        return;

      case 'open':
        // Ignored: no permitted calls exist in OPEN.
        return;

      case 'half-open':
        // Release the most recently started (max start-time) in-flight probe
        // slot, if any — exact parity with the Lua store, which removes the
        // highest-score ZSET entry, even if `now` values were non-monotonic.
        // A probe that outlived probeTimeoutMs already lost its slot, but its
        // outcome still counts toward closing.
        this.pruneProbes(now);
        this.releaseNewestProbe();
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.successThreshold) {
          this.toClosed();
        }
        return;
    }
  }

  recordFailure(now: number): void {
    switch (this.state) {
      case 'closed': {
        this.failures.push(now);
        this.pruneFailures(now);
        if (this.failures.length >= this.config.failureThreshold) {
          this.toOpen(now);
        }
        return;
      }

      case 'open':
        // Ignored: no permitted calls exist in OPEN.
        return;

      case 'half-open':
        // A single probe failure reopens the breaker.
        this.toOpen(now);
        return;
    }
  }

  snapshot(now: number): ICircuitSnapshot {
    return {
      state: this.state,
      failuresInWindow: this.countFailuresInWindow(now),
      halfOpenSuccesses: this.halfOpenSuccesses,
      halfOpenInFlight: this.countProbesInFlight(now),
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenSuccesses = 0;
    this.halfOpenProbes = [];
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private tryHalfOpenProbe(now: number): boolean {
    this.pruneProbes(now);
    if (this.halfOpenProbes.length < this.config.halfOpenMaxCalls) {
      this.halfOpenProbes.push(now);
      return true;
    }
    return false;
  }

  private toOpen(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.halfOpenProbes = [];
  }

  private toClosed(): void {
    this.state = 'closed';
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenSuccesses = 0;
    this.halfOpenProbes = [];
  }

  /** Drop failures with timestamp <= now - windowMs (older-or-equal are OUT). */
  private pruneFailures(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.failures = this.failures.filter((timestamp) => timestamp > cutoff);
  }

  /** Drop expired probes: start time <= now - probeTimeoutMs (slot reclaimed). */
  private pruneProbes(now: number): void {
    const cutoff = now - this.config.probeTimeoutMs;
    this.halfOpenProbes = this.halfOpenProbes.filter((startedAt) => startedAt > cutoff);
  }

  /** Remove the probe with the highest start time (mirrors Lua ZRANGE -1 -1 + ZREM). */
  private releaseNewestProbe(): void {
    if (this.halfOpenProbes.length === 0) {
      return;
    }
    let newestIndex = 0;
    for (let i = 1; i < this.halfOpenProbes.length; i++) {
      if (this.halfOpenProbes[i]! >= this.halfOpenProbes[newestIndex]!) {
        newestIndex = i;
      }
    }
    this.halfOpenProbes.splice(newestIndex, 1);
  }

  /** Non-mutating count of failures still inside the window at `now`. */
  private countFailuresInWindow(now: number): number {
    const cutoff = now - this.config.windowMs;
    let count = 0;
    for (const timestamp of this.failures) {
      if (timestamp > cutoff) {
        count++;
      }
    }
    return count;
  }

  /** Non-mutating count of in-flight probes still within probeTimeoutMs at `now`. */
  private countProbesInFlight(now: number): number {
    const cutoff = now - this.config.probeTimeoutMs;
    let count = 0;
    for (const startedAt of this.halfOpenProbes) {
      if (startedAt > cutoff) {
        count++;
      }
    }
    return count;
  }
}
