import { InvalidCircuitBreakerConfigError } from '../shared/errors';
import { CircuitState, ICircuitBreakerConfig, ICircuitBreakerState, ICircuitSnapshot } from './circuit-breaker-state.interface';

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

  /** HALF_OPEN: probes permitted but not yet resolved. */
  private halfOpenInFlight = 0;

  constructor(private readonly config: ICircuitBreakerConfig) {
    this.validateConfig(config);
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
          this.halfOpenInFlight = 0;
          return this.tryHalfOpenProbe();
        }
        return false;

      case 'half-open':
        return this.tryHalfOpenProbe();
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
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
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
      halfOpenInFlight: this.halfOpenInFlight,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private tryHalfOpenProbe(): boolean {
    if (this.halfOpenInFlight < this.config.halfOpenMaxCalls) {
      this.halfOpenInFlight++;
      return true;
    }
    return false;
  }

  private toOpen(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  private toClosed(): void {
    this.state = 'closed';
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenSuccesses = 0;
    this.halfOpenInFlight = 0;
  }

  /** Drop failures with timestamp <= now - windowMs (older-or-equal are OUT). */
  private pruneFailures(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.failures = this.failures.filter((timestamp) => timestamp > cutoff);
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

  private validateConfig(config: ICircuitBreakerConfig): void {
    this.assertPositiveInteger('failureThreshold', config.failureThreshold, 1);
    this.assertPositiveInteger('windowMs', config.windowMs, 1);
    this.assertPositiveInteger('openDurationMs', config.openDurationMs, 1);
    this.assertPositiveInteger('halfOpenMaxCalls', config.halfOpenMaxCalls, 1);
    this.assertPositiveInteger('successThreshold', config.successThreshold, 1);

    if (config.successThreshold > config.halfOpenMaxCalls) {
      throw new InvalidCircuitBreakerConfigError(`successThreshold (${config.successThreshold}) must be <= halfOpenMaxCalls (${config.halfOpenMaxCalls})`);
    }
  }

  private assertPositiveInteger(name: string, value: number, min: number): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      throw new InvalidCircuitBreakerConfigError(`${name} must be an integer >= ${min} (got ${String(value)})`);
    }
  }
}
