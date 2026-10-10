import { Injectable, Inject } from '@nestjs/common';
import { SEMAPHORE_SERVICE, ISemaphoreService } from '@nestjs-redisx/semaphore';

@Injectable()
export class SemaphoreAdminService {
  constructor(
    @Inject(SEMAPHORE_SERVICE)
    private readonly semaphore: ISemaphoreService,
  ) {}

  async capacitySnapshot(key: string, permits: number) {
    return {
      used: await this.semaphore.usedPermits(key),
      available: await this.semaphore.availablePermits(key, permits),
    };
  }

  // Operator recovery: free every seat on a wedged semaphore. In-flight
  // holders keep running; their release becomes a no-op.
  async unblock(key: string): Promise<number> {
    return this.semaphore.forceReleaseAll(key);
  }
}
