import { Logger } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { MessageHandler } from '../../../shared/types';
import { StreamMessage } from '../../domain/entities/stream-message.entity';
import { IDeadLetterService } from '../ports/dead-letter.port';

/** Polling interval while waiting for in-flight messages during stop. */
const STOP_POLL_INTERVAL_MS = 100;

/** Delay when waiting for concurrency slot to become available. */
const BACKPRESSURE_WAIT_MS = 10;

/** Delay before retrying after a stream consumer error. */
const ERROR_RETRY_DELAY_MS = 1_000;

// Optional metrics interface
interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

export interface IConsumerInstanceConfig<T> {
  stream: string;
  group: string;
  consumer: string;
  handler: MessageHandler<T>;
  batchSize: number;
  blockTimeout: number;
  maxRetries: number;
  concurrency: number;
  startId: string;
  retryInitialDelay: number;
  retryMaxDelay: number;
  retryMultiplier: number;
}

export class ConsumerInstance<T> {
  private readonly logger = new Logger(ConsumerInstance.name);
  private running = false;
  private processing = 0;

  constructor(
    private readonly driver: IRedisDriver,
    private readonly dlqService: IDeadLetterService,
    private readonly config: IConsumerInstanceConfig<T>,
    private readonly metrics?: IMetricsService,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    await this.ensureGroup();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    while (this.processing > 0) {
      await new Promise((r) => setTimeout(r, STOP_POLL_INTERVAL_MS));
    }
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.driver.xgroupCreate(this.config.stream, this.config.group, this.config.startId === '>' ? '$' : '0', true);
    } catch (error) {
      if (!(error as Error).message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        // Backpressure: wait if concurrency limit reached
        while (this.processing >= this.config.concurrency) {
          await new Promise((r) => setTimeout(r, BACKPRESSURE_WAIT_MS));
        }

        const result = await this.driver.xreadgroup(this.config.group, this.config.consumer, [{ key: this.config.stream, id: '>' }], {
          count: this.config.batchSize,
          block: this.config.blockTimeout,
        });

        if (!result?.length) {
          continue;
        }

        for (const streamResult of result) {
          for (const entry of streamResult.entries) {
            void this.processMessage(entry.id, entry.fields);
          }
        }
      } catch (error) {
        this.logger.error('Stream consumer error:', error);
        await new Promise((r) => setTimeout(r, ERROR_RETRY_DELAY_MS));
      }
    }
  }

  private async processMessage(id: string, fields: Record<string, string>): Promise<void> {
    this.processing++;
    const startTime = Date.now();
    const labels = { stream: this.config.stream, group: this.config.group };

    try {
      const data = JSON.parse(fields.data!) as T;
      const attempt = parseInt(fields._attempt ?? '1', 10);
      const timestamp = new Date(parseInt(id.split('-')[0]!, 10));

      const message = new StreamMessage<T>(
        id,
        this.config.stream,
        data,
        attempt,
        timestamp,
        () => this.ack(id),
        (error) => this.handleFailure(id, data, attempt, error),
      );

      await this.config.handler(message);
      await this.ack(id);

      this.metrics?.incrementCounter('redisx_stream_messages_consumed_total', { ...labels, status: 'success' });
      this.metrics?.observeHistogram('redisx_stream_processing_duration_seconds', (Date.now() - startTime) / 1000, labels);
    } catch (error) {
      const attempt = parseInt(fields._attempt ?? '1', 10);
      await this.handleFailure(id, JSON.parse(fields.data!), attempt, error as Error);

      this.metrics?.incrementCounter('redisx_stream_messages_consumed_total', { ...labels, status: 'error' });
      this.metrics?.observeHistogram('redisx_stream_processing_duration_seconds', (Date.now() - startTime) / 1000, labels);
    } finally {
      this.processing--;
    }
  }

  private async ack(id: string): Promise<void> {
    await this.driver.xack(this.config.stream, this.config.group, id);
  }

  private async handleFailure(id: string, data: T, attempt: number, error?: Error): Promise<void> {
    if (attempt >= this.config.maxRetries) {
      await this.dlqService.add(this.config.stream, id, data, error);
      await this.ack(id);

      this.metrics?.incrementCounter('redisx_stream_messages_consumed_total', {
        stream: this.config.stream,
        group: this.config.group,
        status: 'dead_letter',
      });
    } else {
      // Exponential backoff before re-adding
      const delay = Math.min(this.config.retryInitialDelay * Math.pow(this.config.retryMultiplier, attempt - 1), this.config.retryMaxDelay);
      await new Promise((r) => setTimeout(r, delay));

      // ACK original, re-add with incremented attempt for retry
      await this.driver.xadd(this.config.stream, '*', {
        data: JSON.stringify(data),
        _attempt: String(attempt + 1),
      });
      await this.ack(id);

      this.metrics?.incrementCounter('redisx_stream_messages_consumed_total', {
        stream: this.config.stream,
        group: this.config.group,
        status: 'retry',
      });
    }
  }
}
