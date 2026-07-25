/**
 * Pub/Sub plugin options.
 */
export interface IPubSubPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Named Redis client used for PUBLISHING. The plugin additionally creates a
   * DEDICATED subscriber connection (`<client>:pubsub-subscriber`) with the
   * same connection config, because a Redis connection in subscriber mode
   * cannot execute regular commands.
   * @default 'default'
   */
  client?: string;

  /**
   * Prefix applied to every channel name (publish, subscribe, and patterns).
   * Empty by default so channels interoperate with non-RedisX publishers and
   * subscribers; set one (e.g. 'app:') to namespace your events.
   * @default ''
   */
  channelPrefix?: string;
}

/**
 * A message delivered to a subscription handler.
 */
export interface IPubSubMessage<T = unknown> {
  /** Logical channel name (without the configured channelPrefix). */
  channel: string;

  /** Logical pattern that matched (pattern subscriptions only). */
  pattern?: string;

  /** Deserialized payload. Falls back to the raw string if JSON parsing fails. */
  data: T;

  /** Raw payload string exactly as received from Redis. */
  raw: string;
}

/**
 * Subscription message handler. Errors thrown here are caught and logged —
 * they never break the dispatch loop for other handlers.
 */
export type PubSubMessageHandler<T = unknown> = (message: IPubSubMessage<T>) => void | Promise<void>;

/**
 * Handle for an active subscription.
 */
export interface IPubSubSubscription {
  /** Logical channel or pattern this subscription is bound to. */
  target: string;

  /** True when this is a pattern (PSUBSCRIBE) subscription. */
  isPattern: boolean;

  /**
   * Removes this handler. When it is the last handler for the channel/pattern,
   * the underlying Redis subscription is released as well.
   */
  unsubscribe(): Promise<void>;
}

/**
 * Snapshot of the service's active subscriptions (for monitoring).
 */
export interface IPubSubSubscriptionsSnapshot {
  /** Logical channel names with at least one active handler. */
  channels: string[];

  /** Logical patterns with at least one active handler. */
  patterns: string[];
}

// Type aliases for backward compatibility (non-I-prefixed)
export type PubSubPluginOptions = IPubSubPluginOptions;
export type PubSubMessage<T = unknown> = IPubSubMessage<T>;
