import { Injectable, Inject } from '@nestjs/common';
import { CLIENT_MANAGER, RedisClientManager, IHealthStatus } from '@nestjs-redisx/core';

@Injectable()
export class HealthService {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  async checkRedisHealth(): Promise<IHealthStatus> {
    return this.clientManager.healthCheck('default') as Promise<IHealthStatus>;
  }
}
