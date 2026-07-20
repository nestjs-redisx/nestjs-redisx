import { Injectable } from '@nestjs/common';
import { WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';
import { PaymentGateway, UsersApi, UserCache, Charge, User } from './types';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly usersApi: UsersApi,
    private readonly userCache: UserCache,
  ) {}

  // Trips after repeated failures; throws CircuitBreakerOpenError while OPEN.
  @WithCircuitBreaker({ key: 'stripe', failureThreshold: 5, openDurationMs: 30000 })
  async charge(charge: Charge): Promise<{ ok: boolean }> {
    return this.gateway.charge(charge);
  }

  // Key interpolated from the first argument; falls back to cache when OPEN.
  @WithCircuitBreaker({
    key: 'users-api:{0}',
    fallback: (id: string) => ({ id, name: 'cached' }),
  })
  async getUser(id: string): Promise<User> {
    return this.usersApi.getUser(id);
  }

  // Skip execution (resolve to undefined) instead of throwing while OPEN.
  @WithCircuitBreaker({ key: 'users-api', onOpen: 'skip' })
  async warmCache(id: string): Promise<User | null> {
    return this.userCache.get(id);
  }

  // Bypass the breaker entirely for trusted/internal calls via skip().
  @WithCircuitBreaker({
    key: 'users-api',
    skip: (id: string, internal?: boolean) => internal === true,
  })
  async getUserMaybeInternal(id: string, internal?: boolean): Promise<User> {
    return this.usersApi.getUser(id);
  }
}
