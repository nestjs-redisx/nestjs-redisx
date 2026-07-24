import { Injectable, Inject } from '@nestjs/common';
import { CIRCUIT_BREAKER_SERVICE, ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { UsersApi } from '../types';

/**
 * Drive the breaker from an external health signal instead of wrapping every
 * call: a scheduled probe records success/failure manually, and hot-path code
 * only reads the state.
 */
@Injectable()
export class HealthProbeService {
  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly breaker: ICircuitBreakerService,
    private readonly usersApi: UsersApi,
  ) {}

  /** Call this from a scheduler (e.g. @Cron) every few seconds. */
  async probeUsersApi(): Promise<void> {
    try {
      await this.usersApi.getUser('health-check');
      await this.breaker.recordSuccess('users-api');
    } catch {
      await this.breaker.recordFailure('users-api');
    }
  }

  /** Hot path: consult the circuit without mutating it. */
  async isUsersApiAvailable(): Promise<boolean> {
    const snapshot = await this.breaker.getState('users-api');
    return snapshot.state === 'closed';
  }
}
