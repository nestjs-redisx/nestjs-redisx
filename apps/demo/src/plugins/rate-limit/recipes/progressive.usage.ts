import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException } from '../types';

@Injectable()
export class ProgressiveRateLimiter {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
  ) {}

  async checkProgressiveLimit(user: { id: string; createdAt: Date }): Promise<void> {
    const accountAge = Date.now() - user.createdAt.getTime();
    const daysOld = accountAge / (1000 * 60 * 60 * 24);

    let points: number;
    if (daysOld < 7) points = 50;         // New accounts: 50/hour
    else if (daysOld < 30) points = 100;  // 1 week+: 100/hour
    else if (daysOld < 90) points = 500;  // 1 month+: 500/hour
    else points = 1000;                   // 3 months+: 1K/hour

    const result = await this.rateLimitService.check(`user:${user.id}`, {
      points,
      duration: 3600,
    });

    if (!result.allowed) {
      throw new TooManyRequestsException();
    }
  }
}
