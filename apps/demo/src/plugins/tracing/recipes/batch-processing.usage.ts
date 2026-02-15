import { Injectable, Inject } from '@nestjs/common';
import { TRACING_SERVICE, ITracingService } from '@nestjs-redisx/tracing';
import { User, UserRepository } from '../types';

@Injectable()
export class ReportService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
    private readonly userRepo: UserRepository,
  ) {}

  async generateMonthlyReports(): Promise<void> {
    await this.tracing.withSpan('reports.generate_monthly', async () => {
      const users = await this.tracing.withSpan('users.fetch_all', async () => {
        return this.userRepo.findAll();
      });

      this.tracing.setAttribute('users.count', users.length);

      let successCount = 0;
      let errorCount = 0;

      for (const user of users) {
        await this.tracing.withSpan('report.generate_for_user', async () => {
          this.tracing.setAttribute('user.id', user.id);

          try {
            await this.generateReport(user);
            successCount++;
          } catch (error) {
            errorCount++;
            this.tracing.recordException(error as Error);
            throw error;
          }
        }).catch(() => {}); // Continue on individual failures
      }

      this.tracing.setAttribute('reports.success_count', successCount);
      this.tracing.setAttribute('reports.error_count', errorCount);

      this.tracing.addEvent('reports.completed', {
        'reports.total': users.length,
      });
    });
  }

  private async generateReport(_user: User): Promise<void> {
    // report generation logic
  }
}
