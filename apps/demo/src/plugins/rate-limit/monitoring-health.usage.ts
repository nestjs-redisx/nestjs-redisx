import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';

@Injectable()
export class RateLimitHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private rateLimitService: IRateLimitService,
  ) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      await this.rateLimitService.check('health-check', { points: 1, duration: 60 });
      return this.getStatus('rate-limit', true);
    } catch (error) {
      return this.getStatus('rate-limit', false, { message: (error as Error).message });
    }
  }
}
