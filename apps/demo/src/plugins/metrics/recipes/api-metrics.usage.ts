import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';

@Injectable()
export class ApiMetrics implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.registerCounter(
      'http_requests_total',
      'Total HTTP requests',
      ['method', 'endpoint', 'status'],
    );

    this.metrics.registerHistogram(
      'http_request_duration_seconds',
      'HTTP request duration',
      ['method', 'endpoint'],
      [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    );

    this.metrics.registerCounter(
      'http_errors_total',
      'Total HTTP errors',
      ['method', 'endpoint', 'code'],
    );
  }

  trackRequest(
    method: string,
    endpoint: string,
    status: number,
    duration: number,
  ): void {
    this.metrics.incrementCounter('http_requests_total', {
      method,
      endpoint,
      status: status.toString(),
    });

    this.metrics.observeHistogram('http_request_duration_seconds', duration, {
      method,
      endpoint,
    });

    if (status >= 400) {
      this.metrics.incrementCounter('http_errors_total', {
        method,
        endpoint,
        code: status.toString(),
      });
    }
  }
}
