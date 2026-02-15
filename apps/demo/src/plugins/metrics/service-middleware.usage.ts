import { Injectable, NestMiddleware, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class MetricsMiddleware implements NestMiddleware, OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.registerHistogram(
      'http_request_duration_seconds',
      'HTTP request duration',
      ['method', 'route', 'status'],
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const stopTimer = this.metrics.startTimer('http_request_duration_seconds', {
      method: req.method,
      route: req.route?.path || req.path,
    });

    res.on('finish', () => {
      stopTimer();
    });

    next();
  }
}
