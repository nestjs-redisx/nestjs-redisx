import { Injectable, Inject, Logger } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { Job, EmailService, ReportService, ImageService } from './types';

// Producer: Add work to queue
@Injectable()
export class JobQueueService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
  ) {}

  async addJob(job: Job): Promise<void> {
    await this.producer.publish('jobs', {
      id: job.id,
      type: job.type,
      data: job.data,
      priority: job.priority,
      createdAt: new Date(),
    });
  }
}

// Consumer: Process work items
@Injectable()
export class JobWorker {
  private readonly logger = new Logger(JobWorker.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly reportService: ReportService,
    private readonly imageService: ImageService,
  ) {}

  @StreamConsumer({
    stream: 'jobs',
    group: 'workers',
    concurrency: 5,
  })
  async processJob(message: IStreamMessage<Job>): Promise<void> {
    const job = message.data;

    this.logger.log(`Processing job ${job.id} of type ${job.type}`);

    try {
      await this.executeJob(job);
      await message.ack();
    } catch (error) {
      this.logger.error(`Job ${job.id} failed:`, error);
      await message.reject(error);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    switch (job.type) {
      case 'send-email':
        await this.emailService.send(job.data);
        break;
      case 'generate-report':
        await this.reportService.generate(job.data);
        break;
      case 'process-image':
        await this.imageService.process(job.data);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }
}
