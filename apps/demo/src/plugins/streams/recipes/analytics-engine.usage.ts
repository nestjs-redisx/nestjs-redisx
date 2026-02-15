import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { AnalyticsEvent, WarehouseService, TimeseriesDb } from '../types';

@Injectable()
export class AnalyticsEngine {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly warehouseService: WarehouseService,
    private readonly timeseriesDb: TimeseriesDb,
  ) {}

  // Track event
  async track(event: AnalyticsEvent): Promise<void> {
    await this.producer.publish('analytics', {
      eventType: event.type,
      userId: event.userId,
      properties: event.properties,
      timestamp: new Date(),
    });
  }

  // Real-time metrics
  @StreamConsumer({
    stream: 'analytics',
    group: 'metrics',
    concurrency: 10,
  })
  async updateMetrics(message: IStreamMessage<AnalyticsEvent>): Promise<void> {
    const event = message.data;

    // Update counters in-memory or via external store
    console.log(`Tracking metric: ${event.eventType} for user ${event.userId}`);

    await message.ack();
  }

  // User behavior tracking
  @StreamConsumer({
    stream: 'analytics',
    group: 'behavior',
    concurrency: 5,
  })
  async trackBehavior(message: IStreamMessage<AnalyticsEvent>): Promise<void> {
    const event = message.data;

    // Store in time-series database
    await this.timeseriesDb.insert({
      measurement: 'user_events',
      tags: {
        userId: event.userId,
        eventType: event.eventType,
      },
      fields: event.properties,
      timestamp: message.timestamp,
    });

    await message.ack();
  }

  // Data warehouse sync
  @StreamConsumer({
    stream: 'analytics',
    group: 'warehouse',
    batchSize: 100,  // Batch for efficiency
  })
  async syncWarehouse(message: IStreamMessage<AnalyticsEvent>): Promise<void> {
    // Batch insert to data warehouse
    await this.warehouseService.insert('events', message.data);
    await message.ack();
  }
}
