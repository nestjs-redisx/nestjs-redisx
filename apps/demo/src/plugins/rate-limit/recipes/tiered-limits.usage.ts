import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException } from '../types';

@Injectable()
export class TieredRateLimitService {
  private readonly limits: Record<string, { points: number; duration: number }> = {
    free: { points: 100, duration: 3600 },       // 100/hour
    pro: { points: 1000, duration: 3600 },       // 1K/hour
    enterprise: { points: 10000, duration: 3600 }, // 10K/hour
  };

  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
  ) {}

  async checkTieredLimit(userId: string, tier: string): Promise<void> {
    const config = this.limits[tier] || this.limits.free;

    const result = await this.rateLimitService.check(
      `${tier}:${userId}`,
      config,
    );

    if (!result.allowed) {
      throw new TooManyRequestsException(
        `Rate limit exceeded. Retry in ${result.retryAfter}s`,
      );
    }
  }
}
