import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';
import { BatchItem, BatchResult } from './types';

@Injectable()
export class BatchService {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotency: IIdempotencyService,
  ) {}

  async processBatch(items: BatchItem[]): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    for (const item of items) {
      const key = `batch:${item.id}`;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(item))
        .digest('hex');

      const check = await this.idempotency.checkAndLock(key, fingerprint, {
        ttl: 3600,
      });

      if (!check.isNew && check.record?.status === 'completed') {
        results.push(JSON.parse(check.record.response));
        continue;
      }

      try {
        const result = await this.processItem(item);
        await this.idempotency.complete(key, {
          statusCode: 200,
          body: result,
        });
        results.push(result);
      } catch (error) {
        await this.idempotency.fail(key, error.message);
        results.push({ error: error.message });
      }
    }

    return results;
  }

  private async processItem(item: BatchItem): Promise<BatchResult> {
    return { id: item.id };
  }
}
