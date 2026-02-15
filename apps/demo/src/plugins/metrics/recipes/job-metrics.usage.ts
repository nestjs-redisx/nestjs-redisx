import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { Job } from '../types';

@Injectable()
export class JobMetrics implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.registerCounter(
      'jobs_processed_total',
      'Total jobs processed',
      ['type', 'status'],
    );

    this.metrics.registerHistogram(
      'job_duration_seconds',
      'Job processing duration',
      ['type'],
      [1, 5, 10, 30, 60, 300, 600],
    );

    this.metrics.registerGauge(
      'jobs_active',
      'Currently active jobs',
      ['type'],
    );

    this.metrics.registerGauge(
      'job_queue_size',
      'Jobs waiting in queue',
      ['type'],
    );
  }

  async processJob(type: string, job: Job): Promise<void> {
    this.metrics.incrementGauge('jobs_active', { type });
    const stopTimer = this.metrics.startTimer('job_duration_seconds', { type });

    try {
      await this.executeJob(job);

      this.metrics.incrementCounter('jobs_processed_total', {
        type,
        status: 'success',
      });
      stopTimer();
    } catch (error) {
      this.metrics.incrementCounter('jobs_processed_total', {
        type,
        status: 'error',
      });
      stopTimer();
      throw error;
    } finally {
      this.metrics.decrementGauge('jobs_active', { type });
    }
  }

  private async executeJob(_job: Job): Promise<void> {
    // Process the job
  }
}
