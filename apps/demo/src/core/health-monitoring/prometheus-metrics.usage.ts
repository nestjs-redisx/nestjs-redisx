import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { CLIENT_MANAGER, RedisClientManager, ManagerEvent } from '@nestjs-redisx/core';

@Injectable()
export class RedisMetricsCollector implements OnModuleInit {
  private readonly connectionGauge = new Gauge({
    name: 'redis_connection_status',
    help: 'Redis connection status (1=connected, 0=disconnected)',
    labelNames: ['client'],
  });

  private readonly reconnectCounter = new Counter({
    name: 'redis_reconnect_total',
    help: 'Total Redis reconnection attempts',
    labelNames: ['client'],
  });

  private readonly errorCounter = new Counter({
    name: 'redis_error_total',
    help: 'Total Redis errors',
    labelNames: ['client'],
  });

  private readonly latencyHistogram = new Histogram({
    name: 'redis_latency_seconds',
    help: 'Redis command latency',
    labelNames: ['client'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  onModuleInit(): void {
    this.clientManager.on(ManagerEvent.CONNECTED, (data) => {
      this.connectionGauge.labels(data.name).set(1);
    });

    this.clientManager.on(ManagerEvent.DISCONNECTED, (data) => {
      this.connectionGauge.labels(data.name).set(0);
    });

    this.clientManager.on(ManagerEvent.RECONNECTING, (data) => {
      this.reconnectCounter.labels(data.name).inc();
    });

    this.clientManager.on(ManagerEvent.ERROR, (data) => {
      this.errorCounter.labels(data.name).inc();
    });
  }

  recordLatency(client: string, latency: number): void {
    this.latencyHistogram.labels(client).observe(latency / 1000);
  }
}
