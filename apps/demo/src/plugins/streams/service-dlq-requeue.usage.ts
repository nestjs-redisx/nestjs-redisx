import { Injectable, Inject } from '@nestjs/common';
import { DEAD_LETTER_SERVICE, IDeadLetterService } from '@nestjs-redisx/streams';

@Injectable()
export class DLQRequeue {
  constructor(
    @Inject(DEAD_LETTER_SERVICE) private readonly dlq: IDeadLetterService,
  ) {}

  async requeueMessage(
    dlqMessageId: string,
    stream: string,
  ): Promise<void> {
    // Requeue moves the message back to the original stream
    const newId = await this.dlq.requeue(dlqMessageId, stream);
    console.log(`Requeued message ${dlqMessageId}, new ID: ${newId}`);
  }

  async purgeDLQ(stream: string): Promise<void> {
    const count = await this.dlq.purge(stream);
    console.log(`Purged ${count} messages from DLQ: ${stream}`);
  }
}
