import { Injectable } from '@nestjs/common';
import { WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';
import { UsersApi, User } from '../types';

/**
 * Non-critical work: resolve to undefined instead of throwing while OPEN
 * (onOpen: 'skip'), and bypass the breaker entirely for trusted internal
 * calls (skip()).
 */
@Injectable()
export class NonCriticalService {
  constructor(private readonly usersApi: UsersApi) {}

  // Background warmup: silently skipped while the breaker is OPEN.
  @WithCircuitBreaker({ key: 'users-api', onOpen: 'skip' })
  async warmProfileCache(id: string): Promise<User | undefined> {
    return this.usersApi.getUser(id);
  }

  // Internal traffic bypasses the breaker: no state is read or recorded.
  @WithCircuitBreaker({
    key: 'users-api',
    skip: (_id: string, internal?: boolean) => internal === true,
  })
  async getUser(id: string, internal?: boolean): Promise<User> {
    return this.usersApi.getUser(id);
  }
}
