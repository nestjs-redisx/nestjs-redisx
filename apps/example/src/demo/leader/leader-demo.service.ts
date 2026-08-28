/**
 * @fileoverview Service demonstrating leader election.
 *
 * Shows:
 * - @LeaderOnly gating a scheduled job (runs on exactly one instance)
 * - Programmatic leadership checks via LEADER_SERVICE
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LEADER_SERVICE, LeaderOnly, type ILeaderService } from '@nestjs-redisx/leader';

@Injectable()
export class LeaderDemoService {
  private readonly logger = new Logger(LeaderDemoService.name);

  /** How many times the singleton job ran ON THIS instance. */
  cronRuns = 0;

  constructor(
    @Inject(LEADER_SERVICE)
    private readonly leaderService: ILeaderService,
  ) {}

  /**
   * Fires on EVERY instance every 10 seconds; the body runs only on the
   * elected leader. Start two copies of the app to see exactly one of them
   * logging.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  @LeaderOnly()
  async singletonJob() {
    this.cronRuns++;
    this.logger.log(`Singleton job run #${this.cronRuns} on leader "${this.leaderService.instanceId}"`);
  }

  async status() {
    return {
      instanceId: this.leaderService.instanceId,
      isLeader: this.leaderService.isLeader(),
      leaderId: await this.leaderService.getLeaderId(),
      groups: this.leaderService.getGroups(),
      cronRunsOnThisInstance: this.cronRuns,
    };
  }

  async stepDown() {
    await this.leaderService.stepDown();
    return {
      steppedDown: true,
      isLeader: this.leaderService.isLeader(),
      info: 'This instance abstains from candidacy for one ttlMs so another instance can win',
    };
  }
}
