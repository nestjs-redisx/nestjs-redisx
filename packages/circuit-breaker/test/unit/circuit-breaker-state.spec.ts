import { describe, it, expect } from 'vitest';
import { CircuitBreakerState } from '../../src/circuit-breaker/domain/circuit-breaker-state';
import { InvalidCircuitBreakerConfigError } from '../../src/circuit-breaker/shared/errors';
import type { ICircuitBreakerConfig } from '../../src/circuit-breaker/domain/circuit-breaker-state.interface';

/**
 * Base config used across the behavioural tests.
 * Trips after 3 failures within 1s; stays OPEN for 5s; allows 2 half-open
 * probes; closes after 2 successful probes.
 */
function baseConfig(overrides: Partial<ICircuitBreakerConfig> = {}): ICircuitBreakerConfig {
  return {
    failureThreshold: 3,
    windowMs: 1000,
    openDurationMs: 5000,
    halfOpenMaxCalls: 2,
    successThreshold: 2,
    ...overrides,
  };
}

describe('CircuitBreakerState', () => {
  describe('CLOSED', () => {
    it('should start CLOSED and permit requests', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig());

      // When
      const allowed = cb.canRequest(0);

      // Then
      expect(allowed).toBe(true);
      expect(cb.snapshot(0)).toEqual({ state: 'closed', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
    });

    it('should trip CLOSED -> OPEN once failures reach the threshold within the window', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig());

      // When
      cb.recordFailure(100);
      cb.recordFailure(200);
      // Then — still closed below threshold
      expect(cb.snapshot(200)).toMatchObject({ state: 'closed', failuresInWindow: 2 });

      // When — third failure crosses the threshold
      cb.recordFailure(300);

      // Then — OPEN, counters cleared, requests denied within cooldown
      expect(cb.snapshot(300)).toMatchObject({ state: 'open', failuresInWindow: 0 });
      expect(cb.canRequest(300)).toBe(false);
    });

    it('should age out failures older-or-equal to (now - windowMs) so a spread-out burst does not trip', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig());

      // When — three failures, but the first two fall out of the window by the third
      cb.recordFailure(0);
      cb.recordFailure(500);
      cb.recordFailure(1600); // cutoff = 600 -> 0 and 500 dropped, only 1600 remains

      // Then — only one failure counts; still closed
      expect(cb.snapshot(1600)).toMatchObject({ state: 'closed', failuresInWindow: 1 });
    });

    it('should treat a timestamp exactly at (now - windowMs) as OUT of the window', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 2 }));

      // When — first at t=0, second at t=1000 -> cutoff = 0, so t=0 is dropped (<= cutoff)
      cb.recordFailure(0);
      cb.recordFailure(1000);

      // Then — only the second failure is in-window; threshold (2) not reached
      expect(cb.snapshot(1000)).toMatchObject({ state: 'closed', failuresInWindow: 1 });
    });

    it('should NOT reset the window on success (recordSuccess is a no-op in CLOSED)', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig());

      // When — two failures, a success, then a third failure inside the window
      cb.recordFailure(100);
      cb.recordFailure(200);
      cb.recordSuccess(250); // must not clear the two failures
      cb.recordFailure(300);

      // Then — success did not help; breaker trips
      expect(cb.snapshot(300)).toMatchObject({ state: 'open' });
    });
  });

  describe('OPEN', () => {
    function trippedAt(openTime: number, config = baseConfig()): CircuitBreakerState {
      const cb = new CircuitBreakerState(config);
      cb.recordFailure(openTime - 2);
      cb.recordFailure(openTime - 1);
      cb.recordFailure(openTime); // trips here -> openedAt = openTime
      return cb;
    }

    it('should deny requests before the cooldown elapses', () => {
      // Given — opened at 300, openDurationMs = 5000
      const cb = trippedAt(300);

      // When / Then — just before cooldown boundary
      expect(cb.canRequest(300 + 4999)).toBe(false);
      expect(cb.snapshot(5299)).toMatchObject({ state: 'open' });
    });

    it('should transition OPEN -> HALF_OPEN via canRequest once openDurationMs has elapsed', () => {
      // Given
      const cb = trippedAt(300);

      // When — exactly at the cooldown boundary
      const allowed = cb.canRequest(300 + 5000);

      // Then — flips to half-open and grants the first probe
      expect(allowed).toBe(true);
      expect(cb.snapshot(5300)).toMatchObject({ state: 'half-open', halfOpenInFlight: 1, halfOpenSuccesses: 0 });
    });

    it('should ignore recordFailure/recordSuccess while OPEN (openedAt is not pushed forward)', () => {
      // Given — opened at 300
      const cb = trippedAt(300);

      // When — activity during OPEN must be ignored
      cb.recordFailure(400);
      cb.recordSuccess(500);

      // Then — cooldown is still measured from 300, so the boundary still flips at 5300
      expect(cb.canRequest(300 + 4999)).toBe(false);
      expect(cb.canRequest(300 + 5000)).toBe(true);
      expect(cb.snapshot(5300)).toMatchObject({ state: 'half-open' });
    });

    it('should NOT flip OPEN -> HALF_OPEN inside snapshot (snapshot is non-mutating)', () => {
      // Given
      const cb = trippedAt(300);

      // When — query well past the cooldown, but only via snapshot
      const snap = cb.snapshot(999_999);

      // Then — still reports the committed OPEN state
      expect(snap.state).toBe('open');
    });
  });

  describe('HALF_OPEN', () => {
    function halfOpen(config = baseConfig()): CircuitBreakerState {
      const cb = new CircuitBreakerState(config);
      cb.recordFailure(1);
      cb.recordFailure(2);
      cb.recordFailure(3); // OPEN, openedAt = 3
      // Advance past cooldown; this commits OPEN -> HALF_OPEN and consumes probe #1.
      const first = cb.canRequest(3 + config.openDurationMs);
      expect(first).toBe(true);
      return cb;
    }

    it('should cap in-flight probes at halfOpenMaxCalls', () => {
      // Given — halfOpenMaxCalls = 2; first probe already granted in helper
      const cb = halfOpen();
      const now = 3 + 5000;

      // When — second probe granted, third denied
      const second = cb.canRequest(now);
      const third = cb.canRequest(now);

      // Then
      expect(second).toBe(true);
      expect(third).toBe(false);
      expect(cb.snapshot(now)).toMatchObject({ state: 'half-open', halfOpenInFlight: 2 });
    });

    it('should close after successThreshold successful probes and clear counters', () => {
      // Given — two probes in flight
      const cb = halfOpen();
      const now = 3 + 5000;
      cb.canRequest(now); // probe #2 -> inFlight = 2

      // When — two successful probes (successThreshold = 2)
      cb.recordSuccess(now);
      expect(cb.snapshot(now)).toMatchObject({ state: 'half-open', halfOpenSuccesses: 1, halfOpenInFlight: 1 });
      cb.recordSuccess(now);

      // Then — CLOSED and everything cleared
      expect(cb.snapshot(now)).toEqual({ state: 'closed', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
      expect(cb.canRequest(now)).toBe(true);
    });

    it('should reopen on a single probe failure and set a fresh openedAt', () => {
      // Given — in half-open after cooldown from openedAt = 3
      const cb = halfOpen();
      const reopenAt = 3 + 5000 + 42;

      // When — a probe fails
      cb.recordFailure(reopenAt);

      // Then — OPEN again, half-open counters cleared, cooldown measured from reopenAt
      expect(cb.snapshot(reopenAt)).toMatchObject({ state: 'open', halfOpenSuccesses: 0, halfOpenInFlight: 0 });
      expect(cb.canRequest(reopenAt + 4999)).toBe(false);
      expect(cb.canRequest(reopenAt + 5000)).toBe(true); // proves openedAt = reopenAt
    });
  });

  describe('edge cases', () => {
    it('should require successThreshold successes across multiple probes before closing', () => {
      // Given — half-open with room for 2 concurrent probes, needs 2 successes
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 1, halfOpenMaxCalls: 2, successThreshold: 2 }));
      cb.recordFailure(1); // OPEN at 1
      expect(cb.canRequest(1 + 5000)).toBe(true); // probe #1 (inflight 1)
      const now = 1 + 5000;
      expect(cb.canRequest(now)).toBe(true); // probe #2 (inflight 2)

      // When — first success: still half-open (1/2)
      cb.recordSuccess(now);
      expect(cb.snapshot(now)).toMatchObject({ state: 'half-open', halfOpenSuccesses: 1, halfOpenInFlight: 1 });

      // Then — second success closes
      cb.recordSuccess(now);
      expect(cb.snapshot(now).state).toBe('closed');
    });

    it('should free a probe slot on success so another probe can be admitted', () => {
      // Given — 2 concurrent slots, needs 2 successes, but probes arrive one at a time
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 1, halfOpenMaxCalls: 2, successThreshold: 2 }));
      cb.recordFailure(1);
      const now = 1 + 5000;

      // Probe 1 admitted (inflight 1), succeeds -> inflight 0, succ 1
      expect(cb.canRequest(now)).toBe(true);
      cb.recordSuccess(now);
      expect(cb.snapshot(now)).toMatchObject({ state: 'half-open', halfOpenSuccesses: 1, halfOpenInFlight: 0 });

      // Probe 2 admitted on the freed slot, succeeds -> closes
      expect(cb.canRequest(now)).toBe(true);
      cb.recordSuccess(now);
      expect(cb.snapshot(now).state).toBe('closed');
    });

    it('should count failures accurately as the window slides', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 5, windowMs: 1000 }));

      // When
      cb.recordFailure(100);
      cb.recordFailure(200);
      expect(cb.snapshot(200).failuresInWindow).toBe(2);

      // Advance so the first failure (100) ages out at t=1100 (cutoff 100, 100 <= cutoff OUT)
      cb.recordFailure(1100);
      expect(cb.snapshot(1100).failuresInWindow).toBe(2); // 200 and 1100 (100 dropped)
    });

    it('should allow successThreshold == halfOpenMaxCalls', () => {
      // Given/When/Then — valid config, closes after exactly N probes
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 1, halfOpenMaxCalls: 3, successThreshold: 3 }));
      cb.recordFailure(1);
      const now = 1 + 5000;
      cb.canRequest(now);
      cb.canRequest(now);
      cb.canRequest(now);
      cb.recordSuccess(now);
      cb.recordSuccess(now);
      cb.recordSuccess(now);
      expect(cb.snapshot(now).state).toBe('closed');
    });

    it('should reset cleanly from HALF_OPEN', () => {
      // Given — half-open with an in-flight probe
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 1 }));
      cb.recordFailure(1);
      cb.canRequest(1 + 5000);
      expect(cb.snapshot(1 + 5000).state).toBe('half-open');

      // When
      cb.reset();

      // Then
      expect(cb.snapshot(2 + 5000)).toEqual({ state: 'closed', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
    });

    it('should ignore a success recorded in CLOSED but keep the window intact', () => {
      // Given
      const cb = new CircuitBreakerState(baseConfig({ failureThreshold: 2, windowMs: 5000 }));
      cb.recordFailure(100);

      // When — a stray success in CLOSED
      cb.recordSuccess(200);

      // Then — the failure is still counted
      expect(cb.snapshot(300).failuresInWindow).toBe(1);
    });
  });

  describe('reset', () => {
    it('should return to CLOSED and clear all counters from any state', () => {
      // Given — an OPEN breaker
      const cb = new CircuitBreakerState(baseConfig());
      cb.recordFailure(1);
      cb.recordFailure(2);
      cb.recordFailure(3);
      expect(cb.snapshot(3)).toMatchObject({ state: 'open' });

      // When
      cb.reset();

      // Then
      expect(cb.snapshot(10)).toEqual({ state: 'closed', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
      expect(cb.canRequest(10)).toBe(true);
    });
  });

  describe('config validation', () => {
    it.each([
      ['failureThreshold', { failureThreshold: 0 }],
      ['windowMs', { windowMs: 0 }],
      ['openDurationMs', { openDurationMs: 0 }],
      ['halfOpenMaxCalls', { halfOpenMaxCalls: 0 }],
      ['successThreshold', { successThreshold: 0 }],
    ])('should reject non-positive %s', (_name, overrides) => {
      expect(() => new CircuitBreakerState(baseConfig(overrides))).toThrow(InvalidCircuitBreakerConfigError);
    });

    it('should reject non-integer values', () => {
      expect(() => new CircuitBreakerState(baseConfig({ failureThreshold: 1.5 }))).toThrow(InvalidCircuitBreakerConfigError);
      expect(() => new CircuitBreakerState(baseConfig({ windowMs: 100.1 }))).toThrow(InvalidCircuitBreakerConfigError);
    });

    it('should reject successThreshold greater than halfOpenMaxCalls', () => {
      expect(() => new CircuitBreakerState(baseConfig({ halfOpenMaxCalls: 2, successThreshold: 3 }))).toThrow(InvalidCircuitBreakerConfigError);
    });

    it('should accept a valid config', () => {
      expect(() => new CircuitBreakerState(baseConfig())).not.toThrow();
      expect(() => new CircuitBreakerState(baseConfig({ halfOpenMaxCalls: 5, successThreshold: 5 }))).not.toThrow();
    });
  });
});
