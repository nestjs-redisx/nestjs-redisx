import { Injectable, Inject } from '@nestjs/common';
import { DEAD_LETTER_SERVICE, IDeadLetterService } from '@nestjs-redisx/streams';

@Injectable()
export class DLQAutoRequeue {
  constructor(
    @Inject(DEAD_LETTER_SERVICE) private readonly dlq: IDeadLetterService,
  ) {}

  // @Cron('0 */6 * * *')  // Every 6 hours
  async autoRequeue(): Promise<void> {
    const messages = await this.dlq.getMessages('orders', 100);

    // Requeue messages older than 6 hours
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

    for (const msg of messages) {
      if (msg.failedAt.getTime() < sixHoursAgo) {
        await this.dlq.requeue(msg.id, 'orders');
      }
    }
  }
}
