/**
 * Pure, time-injected state of one election group on this instance.
 *
 * The lease view is fail-safe by construction: `isLeader(now)` is true only
 * while the last CONFIRMED lease is unexpired. If the election loop stalls
 * (event-loop pause, stuck Redis call), the local claim to leadership dies
 * with the lease — this instance can never believe in a lease Redis may have
 * already given away.
 */
export class LeaderElectionState {
  /** Epoch ms until which the last confirmed lease is valid; 0 = no lease. */
  private leaderUntil = 0;

  /** Epoch ms until which this instance abstains from candidacy; 0 = none. */
  private cooldownUntil = 0;

  constructor(public readonly group: string) {}

  isLeader(now: number): boolean {
    return now < this.leaderUntil;
  }

  inCooldown(now: number): boolean {
    return now < this.cooldownUntil;
  }

  elected(now: number, ttlMs: number): void {
    this.leaderUntil = now + ttlMs;
  }

  renewed(now: number, ttlMs: number): void {
    this.leaderUntil = now + ttlMs;
  }

  lost(): void {
    this.leaderUntil = 0;
  }

  startCooldown(now: number, cooldownMs: number): void {
    this.cooldownUntil = now + cooldownMs;
  }
}
