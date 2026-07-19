export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ICircuitBreakerConfig {
  /** Failures counted within windowMs that trip CLOSED -> OPEN. Integer >= 1. */
  failureThreshold: number;
  /** Rolling window (ms) over which failures are counted in CLOSED. Integer > 0. */
  windowMs: number;
  /** Time (ms) the breaker stays OPEN before probes are allowed. Integer > 0. */
  openDurationMs: number;
  /** Max probe calls permitted while HALF_OPEN. Integer >= 1. */
  halfOpenMaxCalls: number;
  /** Successful probes required to close from HALF_OPEN. Integer >= 1, must be <= halfOpenMaxCalls. */
  successThreshold: number;
}

export interface ICircuitSnapshot {
  state: CircuitState;
  /** CLOSED: number of failures whose timestamp is still inside the window at the queried time. */
  failuresInWindow: number;
  /** HALF_OPEN: successful probes recorded so far. */
  halfOpenSuccesses: number;
  /** HALF_OPEN: probes permitted (canRequest === true) but not yet resolved. */
  halfOpenInFlight: number;
}

/**
 * Pure, time-injected circuit-breaker state machine. No I/O, no Date.now():
 * every method that depends on time takes an explicit `now` (epoch ms).
 *
 * States & transitions:
 *  CLOSED
 *    - canRequest(now)      -> true.
 *    - recordFailure(now)   -> append `now`; drop failures with timestamp <= now - windowMs
 *                              (strictly older-or-equal are OUT; timestamp > now - windowMs are IN);
 *                              if remaining count >= failureThreshold -> OPEN (openedAt = now, clear counters).
 *    - recordSuccess(now)   -> no-op (window aging alone clears failures; success does NOT reset the window).
 *  OPEN
 *    - canRequest(now)      -> if now - openedAt >= openDurationMs: COMMIT transition to HALF_OPEN
 *                              (halfOpenSuccesses = 0, halfOpenInFlight = 0) and then apply the HALF_OPEN
 *                              rule below; else false. (The OPEN->HALF_OPEN flip is committed ONLY here,
 *                              never in snapshot.)
 *    - recordSuccess/Failure -> ignored (no permitted calls exist in OPEN).
 *  HALF_OPEN
 *    - canRequest(now)      -> if halfOpenInFlight < halfOpenMaxCalls: halfOpenInFlight++, true; else false.
 *    - recordSuccess(now)   -> halfOpenInFlight = max(0, halfOpenInFlight - 1); halfOpenSuccesses++;
 *                              if halfOpenSuccesses >= successThreshold -> CLOSED (clear all counters).
 *    - recordFailure(now)   -> OPEN (openedAt = now, clear half-open counters). A single probe failure reopens.
 *
 * snapshot(now) is non-mutating and reports the COMMITTED state (it does not lazily flip OPEN->HALF_OPEN).
 * reset() returns to CLOSED and clears everything.
 */
export interface ICircuitBreakerState {
  canRequest(now: number): boolean;
  recordSuccess(now: number): void;
  recordFailure(now: number): void;
  snapshot(now: number): ICircuitSnapshot;
  reset(): void;
}
