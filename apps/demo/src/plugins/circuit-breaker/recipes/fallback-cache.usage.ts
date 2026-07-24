import { Injectable, Inject } from '@nestjs/common';
import { CIRCUIT_BREAKER_SERVICE, ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { UsersApi, UserCache, User } from '../types';

/**
 * Serve a cached value instead of erroring while the breaker is OPEN.
 * The dependency gets time to recover; users get slightly stale data.
 */
@Injectable()
export class UsersWithFallbackService {
  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly breaker: ICircuitBreakerService,
    private readonly usersApi: UsersApi,
    private readonly userCache: UserCache,
  ) {}

  async getUser(id: string): Promise<User> {
    return this.breaker.execute(`users-api:${id}`, () => this.usersApi.getUser(id), {
      fallback: async () => {
        const cached = await this.userCache.get(id);
        return cached ?? { id, name: 'unknown' };
      },
    });
  }
}
