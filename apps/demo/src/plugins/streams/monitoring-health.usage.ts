import { Injectable, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { STREAM_PRODUCER, IStreamProducer, STREAM_CONSUMER, IStreamConsumer } from '@nestjs-redisx/streams';

@Injectable()
export class StreamHealthIndicator extends HealthIndicator {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
  ) {
    super();
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      // Check if we can publish
      const testId = await this.producer.publish('health-check', {
        timestamp: Date.now(),
      });

      // Check if we can read stream info
      const info = await this.producer.getStreamInfo('health-check');

      // Check consumer groups
      const pending = await this.consumer.getPending('orders', 'processors');

      const isHealthy = pending.count < 10000;  // Threshold

      return this.getStatus('streams', isHealthy, {
        streamLength: info.length,
        pendingMessages: pending.count,
      });
    } catch (error) {
      return this.getStatus('streams', false, {
        message: (error as Error).message,
      });
    }
  }
}
