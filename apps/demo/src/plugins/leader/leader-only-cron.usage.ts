import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeaderOnly } from '@nestjs-redisx/leader';
import { ReportBuilder } from './types';

@Injectable()
export class ReportJobs {
  constructor(private readonly reports: ReportBuilder) {}

  // The cron fires on every instance of the fleet;
  // the body runs only where the lease is held.
  @Cron(CronExpression.EVERY_HOUR)
  @LeaderOnly()
  async hourlyReport() {
    await this.reports.build('hourly');
  }

  // Independent election group: a different instance may lead it.
  @Cron(CronExpression.EVERY_5_MINUTES)
  @LeaderOnly({ group: 'cleanup' })
  async cleanupExpired() {
    await this.reports.cleanup();
  }
}
