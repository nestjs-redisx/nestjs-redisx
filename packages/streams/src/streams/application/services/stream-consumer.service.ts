import { Injectable, Inject, OnModuleDestroy, Optional } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { ConsumerInstance } from './consumer-instance';
import { STREAMS_REDIS_DRIVER, STREAMS_PLUGIN_OPTIONS, DEAD_LETTER_SERVICE } from '../../../shared/constants';
import { IStreamsPluginOptions, MessageHandler, IConsumeOptions, IConsumerHandle, IPendingInfo, IStreamMessage } from '../../../shared/types';
import { IDeadLetterService } from '../ports/dead-letter.port';
import { IStreamConsumer } from '../ports/stream-consumer.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

@Injectable()
export class StreamConsumerService implements IStreamConsumer, OnModuleDestroy {
  private readonly consumers = new Map<string, ConsumerInstance<unknown>>();

  constructor(
    @Inject(STREAMS_REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(STREAMS_PLUGIN_OPTIONS)
    private readonly config: IStreamsPluginOptions,
    @Inject(DEAD_LETTER_SERVICE) private readonly dlqService: IDeadLetterService,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all(Array.from(this.consumers.values()).map((c) => c.stop()));
  }

  consume<T>(stream: string, group: string, consumer: string, handler: MessageHandler<T>, options: IConsumeOptions = {}): IConsumerHandle {
    const id = `${stream}:${group}:${consumer}`;
    if (this.consumers.has(id)) {
      throw new Error(`Consumer ${id} already exists`);
    }

    const instance = new ConsumerInstance<T>(
      this.driver,
      this.dlqService,
      {
        stream,
        group,
        consumer,
        handler,
        batchSize: options.batchSize ?? this.config.consumer?.batchSize ?? 10,
        blockTimeout: options.blockTimeout ?? this.config.consumer?.blockTimeout ?? 5000,
        maxRetries: options.maxRetries ?? this.config.consumer?.maxRetries ?? 3,
        concurrency: options.concurrency ?? this.config.consumer?.concurrency ?? 1,
        startId: options.startId ?? '>',
        retryInitialDelay: this.config.retry?.initialDelay ?? 1000,
        retryMaxDelay: this.config.retry?.maxDelay ?? 30000,
        retryMultiplier: this.config.retry?.multiplier ?? 2,
      },
      this.metrics,
    );

    this.consumers.set(id, instance as ConsumerInstance<unknown>);
    void instance.start();
    return { id, isRunning: true };
  }

  async stop(handle: IConsumerHandle): Promise<void> {
    const instance = this.consumers.get(handle.id);
    if (instance) {
      await instance.stop();
      this.consumers.delete(handle.id);
    }
  }

  async createGroup(stream: string, group: string, startId = '0'): Promise<void> {
    try {
      await this.driver.xgroupCreate(stream, group, startId, true);
    } catch (error) {
      if (!(error as Error).message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  async getPending(stream: string, group: string): Promise<IPendingInfo> {
    const result = await this.driver.xpending(stream, group);
    return {
      count: result.count,
      minId: result.minId ?? '',
      maxId: result.maxId ?? '',
      consumers: result.consumers.map((c) => ({
        name: c.name,
        pending: c.count,
      })),
    };
  }

  async claimIdle<T>(stream: string, group: string, consumer: string, minIdleTime: number): Promise<IStreamMessage<T>[]> {
    // Get pending messages that have been idle longer than minIdleTime
    const pending = await this.driver.xpendingRange(stream, group, '-', '+', 100);

    // Filter to entries that exceed the idle threshold
    const idlePending = pending.filter((entry) => entry.idleTime >= minIdleTime);

    if (idlePending.length === 0) {
      return [];
    }

    // Claim idle messages via XCLAIM
    const ids = idlePending.map((entry) => entry.id);
    const claimed = await this.driver.xclaim(stream, group, consumer, minIdleTime, ...ids);

    // Map claimed entries to IStreamMessage
    const maxRetries = this.config.consumer?.maxRetries ?? 3;

    return claimed.map((entry) => {
      const data = JSON.parse(entry.fields.data ?? '{}') as T;
      const attempt = parseInt(entry.fields._attempt ?? '1', 10);
      const timestamp = new Date(parseInt(entry.id.split('-')[0]!, 10));

      return {
        id: entry.id,
        stream,
        data,
        attempt,
        timestamp,
        ack: () => this.driver.xack(stream, group, entry.id).then(() => {}),
        reject: async (error?: Error) => {
          if (attempt >= maxRetries) {
            await this.dlqService.add(stream, entry.id, data, error);
          } else {
            await this.driver.xadd(stream, '*', {
              data: JSON.stringify(data),
              _attempt: String(attempt + 1),
            });
          }
          await this.driver.xack(stream, group, entry.id);
        },
      } satisfies IStreamMessage<T>;
    });
  }
}
