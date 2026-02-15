import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';
import { Mailer, EmailQueue } from './types';

@Injectable()
export class EmailService {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
    private readonly mailer: Mailer,
    private readonly emailQueue: EmailQueue,
  ) {}

  async sendEmail(to: string, subject: string): Promise<void> {
    // Limit email sending to prevent spam
    const result = await this.rateLimitService.check('email:send', {
      points: 100,
      duration: 3600, // 100 emails per hour
    });

    if (!result.allowed) {
      // Queue for later
      await this.emailQueue.add(
        { to, subject },
        { delay: (result.retryAfter ?? 60) * 1000 },
      );
      return;
    }

    // Send immediately
    await this.mailer.send({ to, subject });
  }
}
