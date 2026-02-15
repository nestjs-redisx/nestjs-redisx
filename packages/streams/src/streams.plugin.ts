/**
 * Streams plugin for NestJS RedisX.
 * Provides Redis Streams support with consumer groups and DLQ.
 */

import { Provider } from '@nestjs/common';
import { IRedisXPlugin } from '@nestjs-redisx/core';

import { STREAMS_PLUGIN_OPTIONS, STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE } from './shared/constants';
import { IStreamsPluginOptions } from './shared/types';
import { StreamConsumerDiscovery } from './streams/api/discovery/stream-consumer.discovery';
import { DeadLetterService } from './streams/application/services/dead-letter.service';
import { StreamConsumerService } from './streams/application/services/stream-consumer.service';
import { StreamProducerService } from './streams/application/services/stream-producer.service';

const DEFAULT_STREAMS_CONFIG: Required<Omit<IStreamsPluginOptions, 'isGlobal'>> = {
  keyPrefix: 'stream:',
  consumer: {
    batchSize: 10,
    blockTimeout: 5000,
    concurrency: 1,
    maxRetries: 3,
    claimIdleTimeout: 30000,
  },
  producer: {
    maxLen: 100000,
    autoCreate: true,
  },
  dlq: {
    enabled: true,
    streamSuffix: ':dlq',
    maxLen: 10000,
  },
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
  },
  trim: {
    enabled: true,
    maxLen: 100000,
    strategy: 'MAXLEN',
    approximate: true,
  },
};

/**
 * Streams plugin for NestJS RedisX.
 *
 * Provides Redis Streams support:
 * - Stream producer for publishing messages
 * - Consumer groups with automatic acknowledgment
 * - Dead letter queue for failed messages
 * - Message retry with exponential backoff
 * - Stream trimming
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new StreamsPlugin({
 *           consumer: { batchSize: 10, blockTimeout: 5000 },
 *           dlq: { enabled: true },
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class StreamsPlugin implements IRedisXPlugin {
  readonly name = 'streams';
  readonly version = '0.1.0';
  readonly description = 'Redis Streams support with consumer groups and DLQ';

  constructor(private readonly options: IStreamsPluginOptions = {}) {}

  getProviders(): Provider[] {
    const config: IStreamsPluginOptions = {
      keyPrefix: this.options.keyPrefix ?? DEFAULT_STREAMS_CONFIG.keyPrefix,
      consumer: {
        ...DEFAULT_STREAMS_CONFIG.consumer,
        ...this.options.consumer,
      },
      producer: {
        ...DEFAULT_STREAMS_CONFIG.producer,
        ...this.options.producer,
      },
      dlq: {
        ...DEFAULT_STREAMS_CONFIG.dlq,
        ...this.options.dlq,
      },
      retry: {
        ...DEFAULT_STREAMS_CONFIG.retry,
        ...this.options.retry,
      },
      trim: {
        ...DEFAULT_STREAMS_CONFIG.trim,
        ...this.options.trim,
      },
    };

    return [{ provide: STREAMS_PLUGIN_OPTIONS, useValue: config }, { provide: DEAD_LETTER_SERVICE, useClass: DeadLetterService }, { provide: STREAM_PRODUCER, useClass: StreamProducerService }, { provide: STREAM_CONSUMER, useClass: StreamConsumerService }, StreamConsumerDiscovery];
  }

  getExports(): Array<string | symbol | Provider> {
    return [STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE];
  }
}
