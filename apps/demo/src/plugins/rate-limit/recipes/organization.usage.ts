import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException, UserService } from '../types';

@Injectable()
export class OrganizationRateLimiter {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private rateLimitService: IRateLimitService,
    private userService: UserService,
  ) {}

  async checkOrganizationLimit(userId: string): Promise<void> {
    const user = await this.userService.findOne(userId);
    const orgId = user.organizationId;

    // Check org-wide limit
    const orgResult = await this.rateLimitService.check(`org:${orgId}`, {
      points: 10000,
      duration: 3600, // 10K requests per hour for entire org
    });

    if (!orgResult.allowed) {
      throw new TooManyRequestsException(
        'Organization rate limit exceeded',
      );
    }

    // Also check per-user limit within org
    const userResult = await this.rateLimitService.check(
      `org:${orgId}:user:${userId}`,
      {
        points: 1000,
        duration: 3600, // 1K per user
      },
    );

    if (!userResult.allowed) {
      throw new TooManyRequestsException('User rate limit exceeded');
    }
  }
}
