import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private running = true;

  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}

  async onModuleInit() {
    this.tryBecomeLeader();
  }

  private async tryBecomeLeader() {
    while (this.running) {
      try {
        await this.lockService.withLock(
          'leader:scheduler',
          async () => {
            console.log('I am the leader!');
            await this.runScheduledJobs();
          },
          { ttl: 60000, autoRenew: true },
        );
      } catch {
        // Not the leader, wait and try again
        await this.sleep(30000);
      }
    }
  }

  private async runScheduledJobs() { /* process jobs */ }
  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
}
