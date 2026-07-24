import { Injectable } from '@nestjs/common';
import { WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';
import { PaymentGateway, UsersApi, Charge, User } from '../types';

/**
 * One breaker per dependency: a Stripe outage never trips the users-api
 * circuit. Interpolate arguments for finer-grained (per-user / per-tenant)
 * breakers.
 */
@Injectable()
export class PerDependencyService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly usersApi: UsersApi,
  ) {}

  // Static key: all charge() calls share the 'stripe' circuit.
  @WithCircuitBreaker({ key: 'stripe' })
  async charge(charge: Charge): Promise<{ ok: boolean }> {
    return this.gateway.charge(charge);
  }

  // Template key: separate circuit per user id ({0} = first argument).
  @WithCircuitBreaker({ key: 'users-api:{0}' })
  async getUser(id: string): Promise<User> {
    return this.usersApi.getUser(id);
  }

  // Function key: derive the circuit from a payload field.
  @WithCircuitBreaker({ key: (dto: { tenantId: string }) => `tenant:${dto.tenantId}` })
  async syncTenant(dto: { tenantId: string }): Promise<void> {
    await this.usersApi.getUser(dto.tenantId);
  }
}
