import { Injectable, Inject } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const healthStatuses = await this.clientManager.healthCheck();
    const statuses = Array.isArray(healthStatuses)
      ? healthStatuses
      : [healthStatuses];

    const isHealthy = statuses.every((s) => s.healthy);
    const result = this.getStatus(key, isHealthy, {
      clients: statuses.map((s) => ({
        name: s.name,
        status: s.status,
        latency: s.latency,
      })),
    });

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('Redis health check failed', result);
  }
}
