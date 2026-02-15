import { Injectable, Controller, Post, Body } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { ProcessBatchDto, BatchService, EmailService } from '../types';

@Injectable()
@Controller()
export class BatchController {
  constructor(
    private readonly batchService: BatchService,
    private readonly emailService: EmailService,
  ) {}

  @Post('batch/process')
  @Idempotent({
    ttl: 3600,
    keyExtractor: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `batch-${req.body.batchId}`;
    },
  })
  async processBatch(@Body() dto: ProcessBatchDto) {
    const items = await this.batchService.getItems(dto.batchId);

    const results = await Promise.allSettled(
      items.map((item: any) => this.processItem(item)),
    );

    const summary = {
      total: results.length,
      succeeded: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
    };

    // Mark batch as processed
    await this.batchService.markCompleted(dto.batchId, summary);

    // Send notification
    await this.emailService.sendBatchReport(dto.batchId, summary);

    return summary;
  }

  private async processItem(item: any): Promise<any> {
    return item;
  }
}
