import { describe, it, expect } from 'vitest';
import { LeaderElectionState } from '../../src/leader/domain/entities/leader-election-state';

const NOW = 1_700_000_000_000;
const TTL = 15_000;

describe('LeaderElectionState', () => {
  describe('initial state', () => {
    it('should not be leader and not in cooldown when fresh', () => {
      // Given
      const state = new LeaderElectionState('default');

      // Then
      expect(state.group).toBe('default');
      expect(state.isLeader(NOW)).toBe(false);
      expect(state.inCooldown(NOW)).toBe(false);
    });
  });

  describe('elected', () => {
    it('should be leader while the lease is unexpired', () => {
      // Given
      const state = new LeaderElectionState('default');

      // When
      state.elected(NOW, TTL);

      // Then
      expect(state.isLeader(NOW)).toBe(true);
      expect(state.isLeader(NOW + TTL - 1)).toBe(true);
    });

    it('should NOT be leader once the lease expires, even without an explicit demotion (fail-safe)', () => {
      // Given — a stalled loop must never keep claiming leadership
      const state = new LeaderElectionState('default');
      state.elected(NOW, TTL);

      // Then
      expect(state.isLeader(NOW + TTL)).toBe(false);
      expect(state.isLeader(NOW + TTL + 60_000)).toBe(false);
    });
  });

  describe('renewed', () => {
    it('should extend the lease from the renewal time', () => {
      // Given
      const state = new LeaderElectionState('default');
      state.elected(NOW, TTL);

      // When
      state.renewed(NOW + 5000, TTL);

      // Then
      expect(state.isLeader(NOW + TTL + 1)).toBe(true);
      expect(state.isLeader(NOW + 5000 + TTL)).toBe(false);
    });
  });

  describe('lost', () => {
    it('should immediately drop leadership', () => {
      // Given
      const state = new LeaderElectionState('default');
      state.elected(NOW, TTL);

      // When
      state.lost();

      // Then
      expect(state.isLeader(NOW)).toBe(false);
    });
  });

  describe('hold generations (out-of-order release settlements)', () => {
    it('should ignore a confirmedNotHolder for a generation older than the latest confirmed hold', () => {
      // Given — a release issued against generation G...
      const state = new LeaderElectionState('default');
      state.confirmedHolder();
      const issuedAt = state.currentHoldGeneration();

      // ...and a NEWER hold confirmed while that release was on the wire
      state.confirmedHolder();

      // When — the old release settles late
      state.confirmedNotHolder(issuedAt);

      // Then — the newer hold survives: shutdown must still retry
      expect(state.mayHoldLease()).toBe(true);
    });

    it('should clear the flag when the settlement matches the latest hold, and unconditionally without a generation', () => {
      // Given
      const state = new LeaderElectionState('default');
      state.confirmedHolder();

      // When/Then — matching generation clears
      state.confirmedNotHolder(state.currentHoldGeneration());
      expect(state.mayHoldLease()).toBe(false);

      // And — the no-argument form (same-flight confirmations) clears too
      state.confirmedHolder();
      state.confirmedNotHolder();
      expect(state.mayHoldLease()).toBe(false);
    });
  });

  describe('lapsesInMs', () => {
    it('should report the time remaining until the confirmed lease lapses', () => {
      // Given
      const state = new LeaderElectionState('default');
      state.elected(NOW, TTL);

      // Then
      expect(state.lapsesInMs(NOW)).toBe(TTL);
      expect(state.lapsesInMs(NOW + 5000)).toBe(TTL - 5000);
    });

    it('should report 0 with no lease and a non-positive value after the deadline', () => {
      // Given
      const state = new LeaderElectionState('default');

      // Then — no lease
      expect(state.lapsesInMs(NOW)).toBe(0);

      // When — a lease exists but the deadline passed
      state.elected(NOW, TTL);

      // Then
      expect(state.lapsesInMs(NOW + TTL)).toBeLessThanOrEqual(0);

      // And — lost() resets it to none
      state.lost();
      expect(state.lapsesInMs(NOW)).toBe(0);
    });
  });

  describe('cooldown', () => {
    it('should report cooldown within the window and candidacy after it', () => {
      // Given
      const state = new LeaderElectionState('default');

      // When
      state.startCooldown(NOW, TTL);

      // Then
      expect(state.inCooldown(NOW)).toBe(true);
      expect(state.inCooldown(NOW + TTL - 1)).toBe(true);
      expect(state.inCooldown(NOW + TTL)).toBe(false);
    });
  });
});
