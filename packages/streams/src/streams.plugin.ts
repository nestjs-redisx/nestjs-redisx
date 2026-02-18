/**
 * Streams plugin for NestJS RedisX.
 * Provides Redis Streams support with consumer groups and DLQ.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { IRedisXPlugin, IPluginAsyncOptions } from '@nestjs-redisx/core';

import { version } from '../package.json';
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
  readonly version: string = version;
  readonly description = 'Redis Streams support with consumer groups and DLQ';

  private asyncOptions?: IPluginAsyncOptions<IStreamsPluginOptions>;

  constructor(private readonly options: IStreamsPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IStreamsPluginOptions>): StreamsPlugin {
    const plugin = new StreamsPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IStreamsPluginOptions): IStreamsPluginOptions {
    return {
      keyPrefix: options.keyPrefix ?? DEFAULT_STREAMS_CONFIG.keyPrefix,
      consumer: { ...DEFAULT_STREAMS_CONFIG.consumer, ...options.consumer },
      producer: { ...DEFAULT_STREAMS_CONFIG.producer, ...options.producer },
      dlq: { ...DEFAULT_STREAMS_CONFIG.dlq, ...options.dlq },
      retry: { ...DEFAULT_STREAMS_CONFIG.retry, ...options.retry },
      trim: { ...DEFAULT_STREAMS_CONFIG.trim, ...options.trim },
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: STREAMS_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return StreamsPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: STREAMS_PLUGIN_OPTIONS,
          useValue: StreamsPlugin.mergeDefaults(this.options),
        };

    return [optionsProvider, { provide: DEAD_LETTER_SERVICE, useClass: DeadLetterService }, { provide: STREAM_PRODUCER, useClass: StreamProducerService }, { provide: STREAM_CONSUMER, useClass: StreamConsumerService }, StreamConsumerDiscovery];
  }

  getExports(): Array<string | symbol | Provider> {
    return [STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE];
  }
}
