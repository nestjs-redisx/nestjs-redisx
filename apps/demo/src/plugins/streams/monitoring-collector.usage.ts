import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer, STREAM_CONSUMER, IStreamConsumer } from '@nestjs-redisx/streams';
import { StreamMetrics } from './monitoring-metrics.usage';

@Injectable()
export class StreamMonitor {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
    private readonly metrics: StreamMetrics,
  ) {}

  // @Cron('*/30 * * * * *')  // Every 30 seconds
  async collectMetrics(): Promise<void> {
    const streams = ['orders', 'notifications', 'emails'];

    for (const stream of streams) {
      await this.collectStreamMetrics(stream);
    }
  }

  private async collectStreamMetrics(stream: string): Promise<void> {
    // Stream length
    const info = await this.producer.getStreamInfo(stream);
    this.metrics.streamLength.set({ stream }, info.length);

    // DLQ size
    const dlqInfo = await this.producer.getStreamInfo(`${stream}:dlq`);
    this.metrics.dlqSize.set({ stream }, dlqInfo.length);

    // IStreamConsumer has no getGroups() - track known group names
    const groupNames = ['processors', 'notifications', 'analytics'];

    for (const groupName of groupNames) {
      // Pending messages
      const pending = await this.consumer.getPending(stream, groupName);
      this.metrics.pendingMessages.set(
        { stream, group: groupName },
        pending.count
      );

      // Consumer lag (approximation)
      const lag = info.length - pending.count;
      this.metrics.consumerLag.set(
        { stream, group: groupName },
        Math.max(0, lag)
      );
    }
  }
}
