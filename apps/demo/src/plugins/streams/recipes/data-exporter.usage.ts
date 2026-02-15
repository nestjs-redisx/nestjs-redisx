import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { ExportRequest, ExportJob, ExportRepo, S3Service } from '../types';

@Injectable()
export class DataExporter {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly exportRepo: ExportRepo,
    private readonly s3: S3Service,
  ) {}

  async exportData(request: ExportRequest): Promise<string> {
    const jobId = `export-${Date.now()}`;

    await this.producer.publish('exports', {
      jobId,
      userId: request.userId,
      type: request.type,
      filters: request.filters,
      format: request.format,
    });

    return jobId;
  }

  @StreamConsumer({
    stream: 'exports',
    group: 'workers',
    concurrency: 2,  // Limit concurrent exports
  })
  async processExport(message: IStreamMessage<ExportJob>): Promise<void> {
    const job = message.data;

    try {
      // Update status
      await this.exportRepo.updateStatus(job.jobId, 'processing');

      // Fetch data in chunks
      const data = await this.fetchData(job.type, job.filters);

      // Generate file
      const file = await this.generateFile(data, job.format);

      // Upload to S3
      const url = await this.s3.upload(file);

      // Update status and send notification
      await this.exportRepo.updateStatus(job.jobId, 'completed');
      await this.notifyUser(job.userId, url);

      await message.ack();
    } catch (error) {
      await this.exportRepo.updateStatus(job.jobId, 'failed');
      await this.notifyUserError(job.userId, (error as Error).message);
      await message.reject(error as Error);
    }
  }

  private async fetchData(type: string, filters: Record<string, unknown>): Promise<unknown[]> {
    return []; // Stub: fetch from database
  }

  private async generateFile(data: unknown[], format: string): Promise<Buffer> {
    return Buffer.from(''); // Stub: generate CSV/Excel/JSON
  }

  private async notifyUser(userId: string, url: string): Promise<void> {
    // Stub: send notification with download link
  }

  private async notifyUserError(userId: string, error: string): Promise<void> {
    // Stub: send error notification
  }
}
