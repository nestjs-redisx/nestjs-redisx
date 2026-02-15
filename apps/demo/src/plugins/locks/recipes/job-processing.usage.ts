import { Injectable, Inject } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';
import { JobQueue } from '../types';

@Injectable()
export class WorkerService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
    private readonly queue: JobQueue,
  ) {}

  async processNextJob(): Promise<boolean> {
    const job = await this.queue.peek();
    if (!job) return false;

    const lock = await this.lockService.tryAcquire(`job:${job.id}`);
    if (!lock) {
      return false; // Another worker claimed it
    }

    try {
      await this.execute(job);
      await this.queue.complete(job.id);
      return true;
    } finally {
      await lock.release();
    }
  }

  private async execute(job: any) { /* process job */ }
}
