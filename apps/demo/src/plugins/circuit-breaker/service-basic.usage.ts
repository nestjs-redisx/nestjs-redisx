import { Injectable, Inject } from '@nestjs/common';
import { CIRCUIT_BREAKER_SERVICE, ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { UsersApi, UserCache, User } from './types';

@Injectable()
export class UsersService {
  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly breaker: ICircuitBreakerService,
    private readonly usersApi: UsersApi,
    private readonly userCache: UserCache,
  ) {}

  async getUser(id: string): Promise<User> {
    // Guard the call; serve a cached value if the breaker is OPEN.
    return this.breaker.execute(`users-api:${id}`, () => this.usersApi.getUser(id), {
      fallback: async () => {
        const cached = await this.userCache.get(id);
        return cached ?? { id, name: 'unknown' };
      },
    });
  }

  async status(id: string): Promise<string> {
    const snapshot = await this.breaker.getState(`users-api:${id}`);
    return snapshot.state; // 'closed' | 'open' | 'half-open'
  }

  async reportOutcome(id: string, ok: boolean): Promise<void> {
    // Manual recording (e.g. from a health probe) without execute().
    if (ok) {
      await this.breaker.recordSuccess(`users-api:${id}`);
    } else {
      await this.breaker.recordFailure(`users-api:${id}`);
    }
  }

  async clear(id: string): Promise<void> {
    await this.breaker.reset(`users-api:${id}`);
  }
}
