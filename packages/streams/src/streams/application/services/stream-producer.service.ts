import { Injectable, Inject, Optional } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { STREAMS_REDIS_DRIVER, STREAMS_PLUGIN_OPTIONS } from '../../../shared/constants';
import { StreamPublishError } from '../../../shared/errors';
import { IStreamsPluginOptions, IPublishOptions, IStreamInfo } from '../../../shared/types';
import { IStreamProducer } from '../ports/stream-producer.port';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

@Injectable()
export class StreamProducerService implements IStreamProducer {
  constructor(
    @Inject(STREAMS_REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(STREAMS_PLUGIN_OPTIONS)
    private readonly config: IStreamsPluginOptions,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {}

  async publish<T>(stream: string, data: T, options: IPublishOptions = {}): Promise<string> {
    const startTime = Date.now();
    try {
      const maxLen = options.maxLen ?? this.config.producer?.maxLen ?? 100000;
      const id = options.id ?? '*';

      const result = await this.driver.xadd(stream, id, { data: JSON.stringify(data) }, { maxLen, approximate: true });

      this.metrics?.incrementCounter('redisx_stream_messages_published_total', { stream });
      this.metrics?.observeHistogram('redisx_stream_publish_duration_seconds', (Date.now() - startTime) / 1000, { stream });

      return result;
    } catch (error) {
      this.metrics?.incrementCounter('redisx_stream_publish_errors_total', { stream });
      throw new StreamPublishError(stream, error as Error);
    }
  }

  async publishBatch<T>(stream: string, messages: T[], options: IPublishOptions = {}): Promise<string[]> {
    const startTime = Date.now();
    try {
      const maxLen = options.maxLen ?? this.config.producer?.maxLen ?? 100000;
      const results: string[] = [];

      // Use individual xadd calls since pipeline doesn't support stream commands yet
      for (const data of messages) {
        const id = await this.driver.xadd(stream, '*', { data: JSON.stringify(data) }, { maxLen, approximate: true });
        results.push(id);
      }

      this.metrics?.incrementCounter('redisx_stream_messages_published_total', { stream }, messages.length);
      this.metrics?.observeHistogram('redisx_stream_publish_duration_seconds', (Date.now() - startTime) / 1000, { stream });

      return results;
    } catch (error) {
      this.metrics?.incrementCounter('redisx_stream_publish_errors_total', { stream });
      throw new StreamPublishError(stream, error as Error);
    }
  }

  async getStreamInfo(stream: string): Promise<IStreamInfo> {
    try {
      const info = await this.driver.xinfo(stream);
      return {
        length: info.length,
        firstEntry: info.firstEntry
          ? {
              id: info.firstEntry.id,
              timestamp: new Date(parseInt(info.firstEntry.id.split('-')[0] ?? '0', 10)),
            }
          : undefined,
        lastEntry: info.lastEntry
          ? {
              id: info.lastEntry.id,
              timestamp: new Date(parseInt(info.lastEntry.id.split('-')[0] ?? '0', 10)),
            }
          : undefined,
        groups: info.groups,
      };
    } catch {
      // If stream doesn't exist, return empty info
      return {
        length: 0,
        groups: 0,
      };
    }
  }

  async trim(stream: string, maxLen: number): Promise<number> {
    return await this.driver.xtrim(stream, maxLen, true);
  }
}
