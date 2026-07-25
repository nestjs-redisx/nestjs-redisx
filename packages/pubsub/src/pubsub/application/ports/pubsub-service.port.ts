import { IPubSubMessage, IPubSubSubscription, IPubSubSubscriptionsSnapshot, PubSubMessageHandler } from '../../../shared/types';

/**
 * Pub/Sub service port.
 * Defines the public contract for typed Redis Pub/Sub messaging.
 */
export interface IPubSubService {
  /**
   * Publishes a message to a channel. The payload is JSON-serialized.
   *
   * @param channel - Logical channel name (channelPrefix is applied)
   * @param data - Payload (any JSON-serializable value)
   * @returns Number of subscribers that received the message
   *
   * @throws {PubSubPublishError} When serialization or the PUBLISH command fails
   *
   * @example
   * ```typescript
   * await pubsub.publish('user.created', { id: '42', email: 'a@b.c' });
   * ```
   */
  publish<T>(channel: string, data: T): Promise<number>;

  /**
   * Subscribes a handler to a channel. Multiple handlers per channel are
   * supported; the underlying Redis subscription is created on the first
   * handler and released when the last one unsubscribes.
   *
   * @param channel - Logical channel name (channelPrefix is applied)
   * @param handler - Called for every message; handler errors are logged,
   *                  never propagated into the dispatch loop
   * @returns Subscription handle with unsubscribe()
   *
   * @throws {PubSubSubscribeError} When the SUBSCRIBE command fails
   *
   * @example
   * ```typescript
   * const sub = await pubsub.subscribe<UserCreated>('user.created', (msg) => {
   *   console.log(msg.channel, msg.data.id);
   * });
   * await sub.unsubscribe();
   * ```
   */
  subscribe<T>(channel: string, handler: PubSubMessageHandler<T>): Promise<IPubSubSubscription>;

  /**
   * Subscribes a handler to a Redis glob pattern (`*`, `?`, `[..]`).
   * The delivered message carries both the matching pattern and the concrete
   * channel.
   *
   * @param pattern - Logical channel pattern (channelPrefix is applied)
   * @param handler - Called for every matching message
   * @returns Subscription handle with unsubscribe()
   *
   * @throws {PubSubSubscribeError} When the PSUBSCRIBE command fails
   *
   * @example
   * ```typescript
   * await pubsub.psubscribe('user.*', (msg) => {
   *   console.log(msg.pattern, msg.channel, msg.data);
   * });
   * ```
   */
  psubscribe<T>(pattern: string, handler: PubSubMessageHandler<T>): Promise<IPubSubSubscription>;

  /**
   * Removes ALL handlers and releases every underlying Redis subscription.
   * Called automatically on module destroy.
   */
  unsubscribeAll(): Promise<void>;

  /**
   * Returns the logical channels and patterns that currently have handlers
   * (non-mutating; for monitoring/health).
   */
  getSubscriptions(): IPubSubSubscriptionsSnapshot;
}

// Re-export for convenience of consumers importing from the port.
export type { IPubSubMessage, IPubSubSubscription, PubSubMessageHandler };
