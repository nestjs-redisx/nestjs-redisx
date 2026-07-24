import { Injectable, Inject } from '@nestjs/common';
import { CIRCUIT_BREAKER_SERVICE, ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';

/**
 * Operator tooling: surface a degraded-mode banner while a circuit is not
 * closed, and force a stuck circuit back to CLOSED after remediation
 * (e.g. a deploy fixed the dependency).
 */
@Injectable()
export class BreakerOpsService {
  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly breaker: ICircuitBreakerService,
  ) {}

  async degradedBanner(): Promise<string | null> {
    const { state, failuresInWindow } = await this.breaker.getState('stripe');
    if (state === 'open') {
      return 'Payments are temporarily degraded — orders are queued.';
    }
    if (state === 'half-open') {
      return 'Payments are recovering.';
    }
    return failuresInWindow > 0 ? `Payments unstable (${failuresInWindow} recent failures)` : null;
  }

  /** Admin action: clear the circuit immediately after a fix is deployed. */
  async forceClose(): Promise<void> {
    await this.breaker.reset('stripe');
  }
}
