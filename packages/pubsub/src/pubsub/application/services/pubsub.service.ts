import { Injectable, Inject, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { IRedisDriver, DriverEvent } from '@nestjs-redisx/core';

import { PUBSUB_PLUGIN_OPTIONS, PUBSUB_PUBLISHER_DRIVER, PUBSUB_SUBSCRIBER_DRIVER } from '../../../shared/constants';
import { PubSubPublishError, PubSubSubscribeError } from '../../../shared/errors';
import { IPubSubMessage, IPubSubPluginOptions, IPubSubSubscription, IPubSubSubscriptionsSnapshot, PubSubMessageHandler } from '../../../shared/types';
import { IPubSubService } from '../ports/pubsub-service.port';

// Optional metrics integration (same soft-dependency pattern as idempotency)
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
}

/**
 * Typed Redis Pub/Sub service.
 *
 * Publishing goes through the plugin's named client; subscriptions live on a
 * DEDICATED subscriber connection (a Redis connection in subscriber mode
 * cannot execute regular commands). Multiple handlers per channel/pattern are
 * multiplexed locally: the Redis subscription is created on the first handler
 * and released when the last one unsubscribes.
 */
@Injectable()
export class PubSubService implements IPubSubService, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly prefix: string;

  /** full (prefixed) channel -> handlers */
  private readonly channelHandlers = new Map<string, Set<PubSubMessageHandler>>();
  /** full (prefixed) pattern -> handlers */
  private readonly patternHandlers = new Map<string, Set<PubSubMessageHandler>>();

  constructor(
    @Inject(PUBSUB_PLUGIN_OPTIONS)
    private readonly options: IPubSubPluginOptions,
    @Inject(PUBSUB_PUBLISHER_DRIVER)
    private readonly publisher: IRedisDriver,
    @Inject(PUBSUB_SUBSCRIBER_DRIVER)
    private readonly subscriber: IRedisDriver,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {
    this.prefix = options.channelPrefix ?? '';

    // Attach delivery listeners once; they only fire for subscribed targets.
    this.subscriber.on(DriverEvent.MESSAGE, (...args: unknown[]) => {
      const [channel, message] = args as [string, string];
      this.dispatch(this.channelHandlers.get(channel), channel, undefined, message);
    });
    this.subscriber.on(DriverEvent.PMESSAGE, (...args: unknown[]) => {
      const [pattern, channel, message] = args as [string, string, string];
      this.dispatch(this.patternHandlers.get(pattern), channel, pattern, message);
    });
  }

  async publish<T>(channel: string, data: T): Promise<number> {
    const fullChannel = this.prefix + channel;

    let payload: string;
    try {
      payload = JSON.stringify(data === undefined ? null : data);
    } catch (error) {
      throw new PubSubPublishError(channel, error as Error);
    }

    try {
      const receivers = await this.publisher.publish(fullChannel, payload);
      this.metrics?.incrementCounter('redisx_pubsub_published_total');
      return receivers;
    } catch (error) {
      throw new PubSubPublishError(channel, error as Error);
    }
  }

  async subscribe<T>(channel: string, handler: PubSubMessageHandler<T>): Promise<IPubSubSubscription> {
    const fullChannel = this.prefix + channel;
    const handlers = this.channelHandlers.get(fullChannel);

    if (handlers) {
      handlers.add(handler as PubSubMessageHandler);
    } else {
      // First handler for this channel: create the Redis subscription BEFORE
      // registering, so a failed SUBSCRIBE leaves no phantom handler behind.
      try {
        await this.subscriber.subscribe(fullChannel);
      } catch (error) {
        throw new PubSubSubscribeError(channel, error as Error);
      }
      this.channelHandlers.set(fullChannel, new Set([handler as PubSubMessageHandler]));
    }

    return this.buildSubscription(channel, fullChannel, handler as PubSubMessageHandler, false);
  }

  async psubscribe<T>(pattern: string, handler: PubSubMessageHandler<T>): Promise<IPubSubSubscription> {
    const fullPattern = this.prefix + pattern;
    const handlers = this.patternHandlers.get(fullPattern);

    if (handlers) {
      handlers.add(handler as PubSubMessageHandler);
    } else {
      try {
        await this.subscriber.psubscribe(fullPattern);
      } catch (error) {
        throw new PubSubSubscribeError(pattern, error as Error);
      }
      this.patternHandlers.set(fullPattern, new Set([handler as PubSubMessageHandler]));
    }

    return this.buildSubscription(pattern, fullPattern, handler as PubSubMessageHandler, true);
  }

  async unsubscribeAll(): Promise<void> {
    const channels = [...this.channelHandlers.keys()];
    const patterns = [...this.patternHandlers.keys()];
    this.channelHandlers.clear();
    this.patternHandlers.clear();

    if (channels.length > 0) {
      await this.subscriber.unsubscribe(...channels).catch((err: Error) => {
        this.logger.warn(`Failed to unsubscribe channels on shutdown: ${err.message}`);
      });
    }
    if (patterns.length > 0) {
      await this.subscriber.punsubscribe(...patterns).catch((err: Error) => {
        this.logger.warn(`Failed to punsubscribe patterns on shutdown: ${err.message}`);
      });
    }
  }

  getSubscriptions(): IPubSubSubscriptionsSnapshot {
    return {
      channels: [...this.channelHandlers.keys()].map((full) => this.stripPrefix(full)),
      patterns: [...this.patternHandlers.keys()].map((full) => this.stripPrefix(full)),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeAll();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildSubscription(target: string, fullTarget: string, handler: PubSubMessageHandler, isPattern: boolean): IPubSubSubscription {
    const registry = isPattern ? this.patternHandlers : this.channelHandlers;

    return {
      target,
      isPattern,
      unsubscribe: async (): Promise<void> => {
        const handlers = registry.get(fullTarget);
        if (!handlers?.delete(handler)) {
          return; // already removed
        }
        if (handlers.size === 0) {
          registry.delete(fullTarget);
          // Release the Redis subscription; log-only on failure (the local
          // handler is already gone, so no messages will be dispatched).
          const release = isPattern ? this.subscriber.punsubscribe(fullTarget) : this.subscriber.unsubscribe(fullTarget);
          await release.catch((err: Error) => {
            this.logger.warn(`Failed to release subscription "${fullTarget}": ${err.message}`);
          });
        }
      },
    };
  }

  /**
   * Delivers a message to every handler; handler failures are isolated so one
   * bad handler can never break the others (or the subscriber connection).
   */
  private dispatch(handlers: Set<PubSubMessageHandler> | undefined, fullChannel: string, fullPattern: string | undefined, raw: string): void {
    if (!handlers || handlers.size === 0) {
      return;
    }

    const message: IPubSubMessage = {
      channel: this.stripPrefix(fullChannel),
      pattern: fullPattern !== undefined ? this.stripPrefix(fullPattern) : undefined,
      data: this.deserialize(raw, fullChannel),
      raw,
    };

    this.metrics?.incrementCounter('redisx_pubsub_received_total');

    for (const handler of handlers) {
      try {
        Promise.resolve(handler(message)).catch((error: Error) => {
          this.metrics?.incrementCounter('redisx_pubsub_handler_errors_total');
          this.logger.error(`Pub/Sub handler failed for channel "${message.channel}": ${error.message}`);
        });
      } catch (error) {
        this.metrics?.incrementCounter('redisx_pubsub_handler_errors_total');
        this.logger.error(`Pub/Sub handler failed for channel "${message.channel}": ${(error as Error).message}`);
      }
    }
  }

  /** JSON payload; falls back to the raw string on parse failure (fail-open delivery). */
  private deserialize(raw: string, fullChannel: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn(`Non-JSON payload on channel "${this.stripPrefix(fullChannel)}"; delivering the raw string`);
      return raw;
    }
  }

  private stripPrefix(full: string): string {
    return this.prefix && full.startsWith(this.prefix) ? full.slice(this.prefix.length) : full;
  }
}
