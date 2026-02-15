/**
 * @fileoverview Service demonstrating metrics.
 */

import { Injectable, Inject } from '@nestjs/common';
import { METRICS_SERVICE, type IMetricsService } from '@nestjs-redisx/metrics';

@Injectable()
export class MetricsDemoService {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
  ) {}

  /**
   * Increment a counter.
   *
   * @param name - Counter name
   * @param value - Increment value
   */
  async incrementCounter(name: string, value: number) {
    this.metrics.incrementCounter(name, {});
    return { success: true, name, value, message: 'Counter incremented' };
  }

  /**
   * Record a value in a histogram.
   *
   * @param name - Histogram name
   * @param value - Value
   */
  async recordHistogram(name: string, value: number) {
    this.metrics.observeHistogram(name, value, {});
    return { success: true, name, value };
  }

  /**
   * Set a gauge value.
   *
   * @param name - Gauge name
   * @param value - Value
   */
  async setGauge(name: string, value: number) {
    this.metrics.setGauge(name, value, {});
    return { success: true, name, value };
  }

  /**
   * Get metrics in JSON format.
   */
  async getMetricsJson() {
    return this.metrics.getMetricsJson();
  }
}
