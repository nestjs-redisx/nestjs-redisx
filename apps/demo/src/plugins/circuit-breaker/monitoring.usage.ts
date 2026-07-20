import { Injectable, Inject } from '@nestjs/common';
import { CIRCUIT_BREAKER_SERVICE, ICircuitBreakerService, CircuitState } from '@nestjs-redisx/circuit-breaker';

/**
 * Expose circuit state for dashboards / health checks. `getState` is
 * non-mutating, so polling it never affects the breaker.
 */
@Injectable()
export class BreakerMonitor {
  private readonly circuits = ['stripe', 'users-api', 'search'];

  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly breaker: ICircuitBreakerService,
  ) {}

  async snapshot(): Promise<Record<string, CircuitState>> {
    const entries = await Promise.all(this.circuits.map(async (key) => [key, (await this.breaker.getState(key)).state] as const));
    return Object.fromEntries(entries);
  }

  async isDegraded(): Promise<boolean> {
    const states = await this.snapshot();
    return Object.values(states).some((state) => state !== 'closed');
  }
}
