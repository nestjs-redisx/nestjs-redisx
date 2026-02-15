import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer, STREAM_CONSUMER, IStreamConsumer } from '@nestjs-redisx/streams';

@Injectable()
export class StreamDebugger {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
  ) {}

  async inspectStream(stream: string, count: number = 10): Promise<void> {
    const info = await this.producer.getStreamInfo(stream);

    console.log({
      stream,
      length: info.length,
      firstEntry: info.firstEntry,
      lastEntry: info.lastEntry,
      groups: info.groups,
    });
  }

  async inspectPending(stream: string, group: string): Promise<void> {
    // getPending() returns IPendingInfo (summary, not individual messages)
    const pending = await this.consumer.getPending(stream, group);

    console.log({
      totalPending: pending.count,
      oldestId: pending.minId,
      newestId: pending.maxId,
    });

    // Per-consumer breakdown
    pending.consumers.forEach(c => {
      console.log({
        consumer: c.name,
        pending: c.pending,
      });
    });
  }
}
