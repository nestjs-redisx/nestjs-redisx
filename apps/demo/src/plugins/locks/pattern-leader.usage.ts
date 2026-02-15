import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';

@Injectable()
export class SchedulerService {
  private running = true;

  @WithLock({
    key: 'leader:scheduler',
    ttl: 60000,
    autoRenew: true,
  })
  async becomeLeader() {
    // Only one instance becomes leader
    while (this.running) {
      await this.runScheduledJobs();
      await this.sleep(10000);
    }
  }

  private async runScheduledJobs() { /* process jobs */ }
  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
}
