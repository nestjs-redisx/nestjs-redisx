import { Injectable, Inject } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';

@Injectable()
export class WorkerService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}

  async claimWork(jobId: string): Promise<boolean> {
    const lock = await this.lockService.tryAcquire(`job:${jobId}`);

    if (!lock) {
      return false; // Another worker claimed it
    }

    try {
      await this.processJob(jobId);
      return true;
    } finally {
      await lock.release();
    }
  }

  private async processJob(jobId: string) { /* process */ }
}
