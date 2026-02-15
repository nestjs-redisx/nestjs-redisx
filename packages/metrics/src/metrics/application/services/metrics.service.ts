import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as promClient from 'prom-client';

import { METRICS_PLUGIN_OPTIONS } from '../../../shared/constants';
import { MetricRegistrationError } from '../../../shared/errors';
import { IMetricsPluginOptions, IMetricsJson } from '../../../shared/types';
import { IMetricsService } from '../ports/metrics-service.port';

@Injectable()
export class MetricsService implements IMetricsService, OnModuleInit, OnModuleDestroy {
  private readonly registry: promClient.Registry;
  private readonly counters = new Map<string, promClient.Counter>();
  private readonly histograms = new Map<string, promClient.Histogram>();
  private readonly gauges = new Map<string, promClient.Gauge>();
  private readonly prefix: string;
  private readonly defaultLabels: Record<string, string>;
  private readonly latencyBuckets: number[];
  private readonly enabled: boolean;
  private defaultMetricsInterval?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(METRICS_PLUGIN_OPTIONS)
    private readonly config: IMetricsPluginOptions,
  ) {
    this.enabled = config.enabled !== false;
    this.prefix = config.prefix ?? 'redisx_';
    this.defaultLabels = config.defaultLabels ?? {};
    this.latencyBuckets = config.histogramBuckets ?? [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

    this.registry = new promClient.Registry();
    this.registry.setDefaultLabels(this.defaultLabels);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }

    this.registerStandardMetrics();

    if (this.config.collectDefaultMetrics !== false) {
      const collectInterval = this.config.collectInterval ?? 15000;
      promClient.collectDefaultMetrics({
        register: this.registry,
        prefix: this.prefix,
        ...(collectInterval > 0 ? { timeout: collectInterval } : {}),
      });
    }
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }

  private registerStandardMetrics(): void {
    const commandMetrics = this.config.commandMetrics !== false;
    const pluginMetrics = this.config.pluginMetrics !== false;

    // Core metrics
    if (commandMetrics) {
      this.registerCounter(`${this.prefix}commands_total`, 'Total Redis commands executed', ['command', 'client', 'status']);

      this.registerHistogram(`${this.prefix}command_duration_seconds`, 'Redis command latency in seconds', ['command', 'client'], this.latencyBuckets);

      this.registerGauge(`${this.prefix}connections_active`, 'Number of active Redis connections', ['client']);

      this.registerCounter(`${this.prefix}errors_total`, 'Total Redis errors', ['client', 'error_type']);
    }

    // Plugin-specific metrics
    if (pluginMetrics) {
      // Cache metrics
      this.registerCounter(`${this.prefix}cache_hits_total`, 'Total cache hits', ['layer']);

      this.registerCounter(`${this.prefix}cache_misses_total`, 'Total cache misses', ['layer']);

      this.registerGauge(`${this.prefix}cache_hit_ratio`, 'Cache hit ratio (0-1)', ['layer']);

      this.registerGauge(`${this.prefix}cache_size`, 'Current cache size', ['layer']);

      this.registerCounter(`${this.prefix}cache_stampede_prevented_total`, 'Total cache stampede prevention activations');

      // Lock metrics
      this.registerCounter(`${this.prefix}lock_acquisitions_total`, 'Total lock acquisition attempts', ['status']);

      this.registerHistogram(`${this.prefix}lock_wait_duration_seconds`, 'Lock wait time in seconds', [], this.latencyBuckets);

      this.registerHistogram(`${this.prefix}lock_hold_duration_seconds`, 'Lock hold time in seconds', [], this.latencyBuckets);

      this.registerGauge(`${this.prefix}locks_active`, 'Number of currently held locks');

      // Rate limit metrics
      this.registerCounter(`${this.prefix}ratelimit_requests_total`, 'Total rate limit requests', ['status']);

      // Stream metrics
      this.registerCounter(`${this.prefix}stream_messages_published_total`, 'Total stream messages published', ['stream']);

      this.registerCounter(`${this.prefix}stream_messages_consumed_total`, 'Total stream messages consumed', ['stream', 'group', 'status']);

      this.registerHistogram(`${this.prefix}stream_publish_duration_seconds`, 'Stream publish latency in seconds', ['stream'], this.latencyBuckets);

      this.registerCounter(`${this.prefix}stream_publish_errors_total`, 'Total stream publish errors', ['stream']);

      this.registerHistogram(`${this.prefix}stream_processing_duration_seconds`, 'Stream message processing time in seconds', ['stream', 'group'], this.latencyBuckets);

      // Idempotency metrics
      this.registerCounter(`${this.prefix}idempotency_requests_total`, 'Total idempotency requests', ['status']);

      this.registerHistogram(`${this.prefix}idempotency_duration_seconds`, 'Idempotency check duration in seconds', [], this.latencyBuckets);
    }
  }

  incrementCounter(name: string, labels?: Record<string, string>, value = 1): void {
    if (!this.enabled) {
      return;
    }

    const counter = this.counters.get(name);
    if (!counter) {
      return;
    }

    if (labels) {
      counter.inc(labels, value);
    } else {
      counter.inc(value);
    }
  }

  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.enabled) {
      return;
    }

    const histogram = this.histograms.get(name);
    if (!histogram) {
      return;
    }

    if (labels) {
      histogram.observe(labels, value);
    } else {
      histogram.observe(value);
    }
  }

  startTimer(name: string, labels?: Record<string, string>): () => number {
    if (!this.enabled) {
      return () => 0;
    }

    const histogram = this.histograms.get(name);
    if (!histogram) {
      return () => 0;
    }

    const startTime = Date.now();

    return () => {
      const duration = (Date.now() - startTime) / 1000;
      this.observeHistogram(name, duration, labels);
      return duration;
    };
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.enabled) {
      return;
    }

    const gauge = this.gauges.get(name);
    if (!gauge) {
      return;
    }

    if (labels) {
      gauge.set(labels, value);
    } else {
      gauge.set(value);
    }
  }

  incrementGauge(name: string, labels?: Record<string, string>, value = 1): void {
    if (!this.enabled) {
      return;
    }

    const gauge = this.gauges.get(name);
    if (!gauge) {
      return;
    }

    if (labels) {
      gauge.inc(labels, value);
    } else {
      gauge.inc(value);
    }
  }

  decrementGauge(name: string, labels?: Record<string, string>, value = 1): void {
    if (!this.enabled) {
      return;
    }

    const gauge = this.gauges.get(name);
    if (!gauge) {
      return;
    }

    if (labels) {
      gauge.dec(labels, value);
    } else {
      gauge.dec(value);
    }
  }

  async getMetrics(): Promise<string> {
    if (!this.enabled) {
      return '';
    }

    return this.registry.metrics();
  }

  async getMetricsJson(): Promise<IMetricsJson[]> {
    if (!this.enabled) {
      return [];
    }

    const metrics = await this.registry.getMetricsAsJSON();

    return metrics.map((metric: promClient.MetricObjectWithValues<promClient.MetricValue<string>>) => ({
      name: metric.name,
      help: metric.help,
      type: String(metric.type),
      values: metric.values.map((v: promClient.MetricValue<string>) => ({
        labels: (v.labels as Record<string, string>) ?? {},
        value: v.value,
      })),
    }));
  }

  registerCounter(name: string, help: string, labelNames: string[] = []): void {
    if (!this.enabled) {
      return;
    }

    try {
      const counter = new promClient.Counter({
        name,
        help,
        labelNames,
        registers: [this.registry],
      });

      this.counters.set(name, counter);
    } catch (error) {
      throw new MetricRegistrationError(name, error instanceof Error ? error : undefined);
    }
  }

  registerHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): void {
    if (!this.enabled) {
      return;
    }

    try {
      const histogram = new promClient.Histogram({
        name,
        help,
        labelNames,
        buckets: buckets ?? this.latencyBuckets,
        registers: [this.registry],
      });

      this.histograms.set(name, histogram);
    } catch (error) {
      throw new MetricRegistrationError(name, error instanceof Error ? error : undefined);
    }
  }

  registerGauge(name: string, help: string, labelNames: string[] = []): void {
    if (!this.enabled) {
      return;
    }

    try {
      const gauge = new promClient.Gauge({
        name,
        help,
        labelNames,
        registers: [this.registry],
      });

      this.gauges.set(name, gauge);
    } catch (error) {
      throw new MetricRegistrationError(name, error instanceof Error ? error : undefined);
    }
  }
}
