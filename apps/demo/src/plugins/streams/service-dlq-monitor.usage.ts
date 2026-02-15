import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { AlertService } from './types';

@Injectable()
export class DLQMonitor {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly alertService: AlertService,
  ) {}

  async getDLQCount(stream: string): Promise<number> {
    const info = await this.producer.getStreamInfo(`${stream}:dlq`);
    return info.length;
  }

  // @Cron('*/5 * * * *')  // Every 5 minutes
  async checkDLQ(): Promise<void> {
    const count = await this.getDLQCount('orders');

    if (count > 100) {
      await this.alertService.send({
        title: 'High DLQ Count',
        message: `${count} messages in orders:dlq`,
        severity: 'critical',
      });
    }
  }
}
