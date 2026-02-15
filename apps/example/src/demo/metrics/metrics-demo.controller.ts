/**
 * @fileoverview Controller demonstrating metrics.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MetricsDemoService } from './metrics-demo.service';

@Controller('demo/metrics')
export class MetricsDemoController {
  constructor(private readonly metricsDemo: MetricsDemoService) {}

  /**
   * Get metrics in JSON format.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/metrics/json
   * ```
   */
  @Get('json')
  async json() {
    return this.metricsDemo.getMetricsJson();
  }

  /**
   * Increment a custom counter.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/metrics/counter \
   *   -H "Content-Type: application/json" \
   *   -d '{"name": "app_requests_total", "value": 1}'
   * ```
   */
  @Post('counter')
  @HttpCode(HttpStatus.OK)
  async counter(@Body() body: { name: string; value: number }) {
    return this.metricsDemo.incrementCounter(body.name, body.value);
  }

  /**
   * Record a value in a histogram.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/metrics/histogram \
   *   -H "Content-Type: application/json" \
   *   -d '{"name": "app_response_time_seconds", "value": 0.234}'
   * ```
   */
  @Post('histogram')
  @HttpCode(HttpStatus.OK)
  async histogram(@Body() body: { name: string; value: number }) {
    return this.metricsDemo.recordHistogram(body.name, body.value);
  }

  /**
   * Set a gauge value.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/metrics/gauge \
   *   -H "Content-Type: application/json" \
   *   -d '{"name": "app_active_connections", "value": 42}'
   * ```
   */
  @Post('gauge')
  @HttpCode(HttpStatus.OK)
  async gauge(@Body() body: { name: string; value: number }) {
    return this.metricsDemo.setGauge(body.name, body.value);
  }
}
