import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException } from '../types';

@Injectable()
export class TimeBasedRateLimiter {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
  ) {}

  async checkTimeBasedLimit(userId: string): Promise<void> {
    const hour = new Date().getHours();
    // More generous limits during off-peak hours
    const points = hour >= 22 || hour < 6 ? 1000 : 100;

    const result = await this.rateLimitService.check(`user:${userId}`, {
      points,
      duration: 3600,
    });

    if (!result.allowed) {
      throw new TooManyRequestsException();
    }
  }
}
