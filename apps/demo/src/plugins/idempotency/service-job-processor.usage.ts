import { Injectable, Inject } from '@nestjs/common';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';

@Injectable()
export class JobProcessor {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotency: IIdempotencyService,
  ) {}

  async processJob(jobId: string, data: any): Promise<void> {
    const key = `job:${jobId}`;

    // checkAndLock handles concurrent requests internally (waits if locked)
    const result = await this.idempotency.checkAndLock(key, jobId, {
      ttl: 3600,
    });

    if (!result.isNew) {
      console.log('Job already processed, skipping');
      return;
    }

    try {
      await this.doWork(data);
      await this.idempotency.complete(key, {
        statusCode: 200,
        body: { success: true },
      });
    } catch (error) {
      await this.idempotency.fail(key, error.message);
      throw error;
    }
  }

  private async doWork(data: any): Promise<void> {
    // Process job data
  }
}
