import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { TooManyRequestsException } from '../types';

@Injectable()
export class WebhookService {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private rateLimitService: IRateLimitService,
  ) {}

  async processWebhook(sourceUrl: string, payload: any): Promise<void> {
    // Rate limit by source URL
    const result = await this.rateLimitService.check(
      `webhook:${sourceUrl}`,
      {
        algorithm: 'token-bucket',
        points: 100,    // Bucket capacity
        refillRate: 10,  // 10 per second sustained
      },
    );

    if (!result.allowed) {
      throw new TooManyRequestsException(
        `Webhook from ${sourceUrl} exceeded rate limit. Retry in ${result.retryAfter}s`,
      );
    }

    await this.processPayload(payload);
  }

  private async processPayload(payload: any): Promise<void> {
    // Process the webhook payload
  }
}
