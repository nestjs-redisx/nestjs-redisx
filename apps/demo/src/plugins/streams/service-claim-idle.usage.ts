import { Injectable, Inject } from '@nestjs/common';
import { STREAM_CONSUMER, IStreamConsumer } from '@nestjs-redisx/streams';

@Injectable()
export class IdleMessageClaimer {
  constructor(
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
  ) {}

  // @Cron('*/1 * * * *')  // Every minute
  async claimIdleMessages(): Promise<void> {
    // Claim messages idle > 60 seconds
    const claimed = await this.consumer.claimIdle(
      'orders',
      'processors',
      'claimer-worker',
      60000,
    );

    if (claimed.length === 0) return;

    // Process claimed messages
    for (const message of claimed) {
      try {
        await this.processMessage(message);
        await message.ack();
      } catch (error) {
        await message.reject(error);
      }
    }
  }

  private async processMessage(message: any): Promise<void> {
    // Process the claimed message
  }
}
