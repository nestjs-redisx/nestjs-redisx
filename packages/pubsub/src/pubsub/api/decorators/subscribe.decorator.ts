import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for @Subscribe options.
 */
export const PUBSUB_SUBSCRIBE_METADATA = Symbol.for('PUBSUB_SUBSCRIBE_METADATA');

/**
 * Options for the @Subscribe decorator.
 */
export interface ISubscribeOptions {
  /** Logical channel name to subscribe to (channelPrefix is applied). */
  channel?: string;

  /** Redis glob pattern (`*`, `?`, `[..]`) to subscribe to via PSUBSCRIBE. */
  pattern?: string;
}

/**
 * Declares a provider method as a Pub/Sub message handler. The method is
 * auto-subscribed on application startup via discovery and receives an
 * `IPubSubMessage<T>` argument.
 *
 * Requires `DiscoveryModule` from `@nestjs/core` to be available (imported
 * automatically by most applications; the discovery service logs a warning
 * when absent).
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserEventsHandler {
 *   @Subscribe('user.created')
 *   onUserCreated(message: IPubSubMessage<UserCreatedEvent>) {
 *     console.log(message.data.id);
 *   }
 *
 *   @Subscribe({ pattern: 'user.*' })
 *   onAnyUserEvent(message: IPubSubMessage) {
 *     console.log(message.pattern, message.channel);
 *   }
 * }
 * ```
 */
export function Subscribe(channelOrOptions: string | ISubscribeOptions): MethodDecorator {
  const options: ISubscribeOptions = typeof channelOrOptions === 'string' ? { channel: channelOrOptions } : channelOrOptions;

  if (!options.channel && !options.pattern) {
    throw new Error('@Subscribe requires a channel name or a { pattern } option');
  }
  if (options.channel && options.pattern) {
    throw new Error('@Subscribe accepts either a channel or a pattern, not both');
  }

  return SetMetadata(PUBSUB_SUBSCRIBE_METADATA, options);
}
