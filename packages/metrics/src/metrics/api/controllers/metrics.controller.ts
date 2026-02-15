import { Controller, Get, Header, Inject } from '@nestjs/common';

import { METRICS_SERVICE } from '../../../shared/constants';
import { IMetricsService } from '../../application/ports/metrics-service.port';

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_SERVICE) private readonly metricsService: IMetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
