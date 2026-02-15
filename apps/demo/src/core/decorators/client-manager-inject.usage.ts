import { Injectable, Inject } from '@nestjs/common';
import { CLIENT_MANAGER, RedisClientManager, IHealthStatus } from '@nestjs-redisx/core';

@Injectable()
export class AdminService {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  getClientNames(): string[] {
    return this.clientManager.getClientNames();
  }

  async healthCheck(): Promise<IHealthStatus[]> {
    return this.clientManager.healthCheck() as Promise<IHealthStatus[]>;
  }
}
