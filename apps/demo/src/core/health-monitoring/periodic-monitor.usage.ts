import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

// Periodic health check
@Injectable()
export class HealthMonitor implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout;

  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(async () => {
      const health = await this.clientManager.healthCheck();
      // Process health results
    }, 30000);  // Every 30 seconds
  }

  onModuleDestroy(): void {
    clearInterval(this.interval);
  }
}
