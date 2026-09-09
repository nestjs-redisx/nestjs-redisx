/**
 * Pure, time-injected state of one election group on this instance.
 *
 * The lease view is fail-safe by construction: `isLeader(now)` is true only
 * while the last CONFIRMED lease is unexpired. If the election loop stalls
 * (event-loop pause, stuck Redis call), the local claim to leadership dies
 * with the lease — this instance cannot believe in a lease Redis may have
 * already given away, as long as the injected clock does not step BACKWARD
 * (deadlines are wall-clock deltas; see the documented clock assumptions).
 */
export class LeaderElectionState {
  /** Epoch ms until which the last confirmed lease is valid; 0 = no lease. */
  private leaderUntil = 0;

  /** Epoch ms until which this instance abstains from candidacy; 0 = none. */
  private cooldownUntil = 0;

  /**
   * True while the store may still hold this instance's id. Set on every
   * confirmed acquire/renewal; cleared only when the store CONFIRMS the seat
   * is not ours (renew/acquire returned false, release settled). A local
   * demotion after a store ERROR keeps it true — the key may still carry our
   * id, and shutdown/stepDown must clear that residue or failover stalls.
   */
  private holding = false;

  /**
   * Bumped on every confirmed hold. A release settling out of order (wire
   * reordering: it deleted the OLD residue, then a newer own acquire won
   * the key) must not clear `holding` for a hold it never observed — see
   * `confirmedNotHolder(asOfGeneration)`.
   */
  private holdGeneration = 0;

  constructor(public readonly group: string) {}

  isLeader(now: number): boolean {
    return now < this.leaderUntil;
  }

  /**
   * The local lease expired without any demotion being observed (event-loop
   * stall, clock jump, store latency beyond `ttl - renewInterval`). One-shot:
   * `lost()` resets it.
   */
  hasLapsed(now: number): boolean {
    return this.leaderUntil !== 0 && now >= this.leaderUntil;
  }

  /**
   * Milliseconds until the confirmed lease lapses; <= 0 when there is no
   * lease or it already lapsed. Drives the service's lapse watchdog.
   */
  lapsesInMs(now: number): number {
    return this.leaderUntil === 0 ? 0 : this.leaderUntil - now;
  }

  inCooldown(now: number): boolean {
    return now < this.cooldownUntil;
  }

  /** The store may still hold our id even though we are locally demoted. */
  mayHoldLease(): boolean {
    return this.holding;
  }

  elected(now: number, ttlMs: number): void {
    this.leaderUntil = now + ttlMs;
    this.holding = true;
    this.holdGeneration += 1;
  }

  renewed(now: number, ttlMs: number): void {
    this.leaderUntil = now + ttlMs;
    this.holding = true;
    this.holdGeneration += 1;
  }

  lost(): void {
    this.leaderUntil = 0;
  }

  /**
   * The store confirmed the key carries this instance's id even though the
   * instance is NOT locally leader — a superseded (stale) acquire or renewal
   * that won on the wire. Tracked so stepDown/shutdown release the seat if
   * the best-effort quiet release fails; otherwise a dead process's residue
   * would block the group for the remaining ttl.
   */
  confirmedHolder(): void {
    this.holding = true;
    this.holdGeneration += 1;
  }

  /**
   * A store call ERRORED after possibly writing: an acquire rejected
   * client-side (envelope/command deadline) may still have landed and WON
   * server-side. Tracked like a confirmed hold — generation bump included,
   * so an older release settling late cannot clear it — and the next
   * SETTLED store answer corrects the flag on in-order transports (a
   * transport-replayed write landing after that answer remains the
   * documented ttl-bounded residue). stepDown/shutdown then release the
   * possible win; a no-op CAS when nothing landed.
   */
  possiblyHolder(): void {
    this.holding = true;
    this.holdGeneration += 1;
  }

  /** Generation of the latest confirmed hold (see `confirmedNotHolder`). */
  currentHoldGeneration(): number {
    return this.holdGeneration;
  }

  /**
   * The store confirmed this instance is not the holder. When
   * `asOfGeneration` is given (release settlements — which are issued
   * fire-and-forget and can settle out of order), the flag is cleared only
   * if NO newer hold was confirmed since the release was issued: a release
   * that deleted an OLD residue while a newer own acquire re-won the key
   * proves nothing about the CURRENT key, and clearing here would disarm
   * the stepDown/shutdown release retry the residue tracking exists for.
   */
  confirmedNotHolder(asOfGeneration?: number): void {
    if (asOfGeneration !== undefined && asOfGeneration !== this.holdGeneration) {
      return;
    }
    this.holding = false;
  }

  startCooldown(now: number, cooldownMs: number): void {
    this.cooldownUntil = now + cooldownMs;
  }
}
