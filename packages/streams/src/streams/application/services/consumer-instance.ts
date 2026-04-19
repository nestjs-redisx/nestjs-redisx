import { Logger } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { MessageHandler } from '../../../shared/types';
import { StreamMessage } from '../../domain/entities/stream-message.entity';
import { IDeadLetterService } from '../ports/dead-letter.port';

/** Polling interval while waiting for in-flight messages during stop. */
const STOP_POLL_INTERVAL_MS = 50;

/** Delay when waiting for concurrency slot to become available. */
const BACKPRESSURE_WAIT_MS = 10;

/** Delay before retrying after a stream consumer error. */
const ERROR_RETRY_DELAY_MS = 1_000;

const SHUTDOWN_SENTINEL = '__shutdown__' as const;

/**
 * Substrings used to detect benign connection-teardown errors that should be
 * swallowed during graceful shutdown (vs. re-thrown / logged on the happy path).
 */
const SHUTDOWN_ERROR_HINTS = ['Connection is closed', 'Connection closed', 'Client is closed', 'The client is closed', 'Driver is not connected', 'DRIVER_NOT_CONNECTED', 'ECONNRESET', 'ECONNREFUSED'];

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
  private shutdownSignal?: Promise<typeof SHUTDOWN_SENTINEL>;
  private resolveShutdown?: (value: typeof SHUTDOWN_SENTINEL) => void;
  private pollPromise?: Promise<void>;

  constructor(
    private readonly driver: IRedisDriver,
    private readonly dlqService: IDeadLetterService,
    private readonly config: IConsumerInstanceConfig<T>,
    private readonly metrics?: IMetricsService,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.shutdownSignal = new Promise((resolve) => {
      this.resolveShutdown = resolve;
    });
    await this.ensureGroup();
    this.pollPromise = this.poll();
  }

  /**
   * Stop the consumer and wait for the poll loop + in-flight messages to drain.
   * Safe to call multiple times. After `timeoutMs` elapses the method returns
   * even if some messages are still being processed — their handlers keep
   * running in the background until their own work completes or the owning
   * Redis client disconnects.
   */
  async stop(timeoutMs: number = 10_000): Promise<void> {
    if (!this.running && !this.pollPromise) {
      return;
    }

    this.running = false;
    this.resolveShutdown?.(SHUTDOWN_SENTINEL);

    const deadline = Date.now() + Math.max(0, timeoutMs);

    if (this.pollPromise) {
      const remaining = Math.max(0, deadline - Date.now());
      await Promise.race([this.pollPromise, sleep(remaining)]);
    }

    while (this.processing > 0 && Date.now() < deadline) {
      await sleep(STOP_POLL_INTERVAL_MS);
    }

    if (this.processing > 0) {
      this.logger.warn(`Consumer ${this.config.consumer} on ${this.config.stream}:${this.config.group} did not finish within ${timeoutMs}ms; ${this.processing} message(s) still in flight.`);
    }

    this.pollPromise = undefined;
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
        while (this.running && this.processing >= this.config.concurrency) {
          await this.sleepOrShutdown(BACKPRESSURE_WAIT_MS);
        }
        if (!this.running) break;

        const xreadPromise = this.driver
          .xreadgroup(this.config.group, this.config.consumer, [{ key: this.config.stream, id: '>' }], {
            count: this.config.batchSize,
            block: this.config.blockTimeout,
          })
          .catch((error: unknown) => {
            // After a shutdown was initiated the underlying driver may be torn
            // down before the blocking XREADGROUP returns; swallow any error
            // here so the orphaned promise does not leak as an unhandled
            // rejection once the poll loop has already broken out of the race.
            if (!this.running) {
              return null;
            }
            throw error;
          });

        const result = await Promise.race([xreadPromise, this.shutdownSignal!]);

        if (!this.running || result === SHUTDOWN_SENTINEL) break;
        if (!result?.length) continue;

        for (const streamResult of result) {
          for (const entry of streamResult.entries) {
            void this.processMessage(entry.id, entry.fields);
          }
        }
      } catch (error) {
        if (!this.running || isShutdownError(error)) break;
        this.logger.error('Stream consumer error:', error);
        await this.sleepOrShutdown(ERROR_RETRY_DELAY_MS);
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
      // Driver can disappear mid-processing when the application is shutting
      // down. Don't try to ACK / re-enqueue into a torn-down connection — let
      // Redis PEL redeliver the message to the next consumer on restart.
      if (!this.running || isShutdownError(error)) {
        return;
      }

      try {
        const attempt = parseInt(fields._attempt ?? '1', 10);
        await this.handleFailure(id, JSON.parse(fields.data!), attempt, error as Error);
      } catch (failureError) {
        if (!this.running || isShutdownError(failureError)) {
          return;
        }
        this.logger.error('Stream message failure handler error:', failureError);
      }

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
      await this.sleepOrShutdown(delay);

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

  /**
   * Sleep for `ms` but resolve early if the shutdown signal fires, and always
   * clear the underlying timer so it does not keep the Node event loop alive.
   */
  private async sleepOrShutdown(ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timerPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    try {
      await Promise.race([timerPromise, this.shutdownSignal!]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function isShutdownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return SHUTDOWN_ERROR_HINTS.some((hint) => message.includes(hint));
}
