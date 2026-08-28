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
