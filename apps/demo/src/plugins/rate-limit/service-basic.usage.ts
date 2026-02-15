import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException, UserService } from './types';

@Injectable()
export class ApiService {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
    private readonly userService: UserService,
  ) {}

  async checkRateLimit(userId: string): Promise<boolean> {
    const result = await this.rateLimitService.check(`user:${userId}`, {
      points: 100,
      duration: 60,
      algorithm: 'sliding-window',
    });

    return result.allowed;
  }

  async getRateLimitStatus(userId: string) {
    const result = await this.rateLimitService.peek(`user:${userId}`, {
      points: 100,
      duration: 60,
    });

    return {
      remaining: result.remaining,
      limit: result.limit,
      resetAt: new Date(result.reset * 1000),
    };
  }

  async resetUserLimit(userId: string): Promise<void> {
    await this.rateLimitService.reset(`user:${userId}`);
  }

  async apiCall(userId: string, isPremium: boolean) {
    const config = isPremium
      ? { points: 1000, duration: 60 }
      : { points: 100, duration: 60 };

    const result = await this.rateLimitService.check(`user:${userId}`, config);

    if (!result.allowed) {
      throw new TooManyRequestsException();
    }

    return { success: true };
  }
}
