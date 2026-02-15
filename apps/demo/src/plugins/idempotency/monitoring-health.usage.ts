import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';

@Injectable()
export class IdempotencyHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private idempotency: IIdempotencyService,
  ) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      // Test write
      const testKey = `health-check-${Date.now()}`;
      await this.idempotency.checkAndLock(testKey, 'health-check');

      await this.idempotency.complete(testKey, {
        statusCode: 200,
        body: {},
      });

      // Test read
      const record = await this.idempotency.get(testKey);

      // Cleanup
      await this.idempotency.delete(testKey);

      return this.getStatus('idempotency', true, {
        message: 'Idempotency service healthy',
      });
    } catch (error) {
      return this.getStatus('idempotency', false, {
        message: error.message,
      });
    }
  }
}
