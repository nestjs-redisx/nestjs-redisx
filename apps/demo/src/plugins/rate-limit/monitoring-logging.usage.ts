import { Injectable, Inject, Logger } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService, RateLimitResult } from '@nestjs-redisx/rate-limit';

@Injectable()
export class LoggingRateLimitService {
  private readonly logger = new Logger('RateLimit');

  constructor(
    @Inject(RATE_LIMIT_SERVICE) private readonly rateLimitService: IRateLimitService,
  ) {}

  async check(key: string, config?: any): Promise<RateLimitResult> {
    const result = await this.rateLimitService.check(key, config);
    this.logger.debug(
      `Check: ${key} - ${result.allowed ? 'ALLOWED' : 'REJECTED'} (${result.remaining} left)`,
    );
    return result;
  }
}
