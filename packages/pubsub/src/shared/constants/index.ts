/**
 * Injection tokens and default configuration for the Pub/Sub plugin.
 */

import { IPubSubPluginOptions } from '../types';

/**
 * Injection token for Pub/Sub plugin options.
 */
export const PUBSUB_PLUGIN_OPTIONS = Symbol.for('PUBSUB_PLUGIN_OPTIONS');

/**
 * Injection token for the Pub/Sub service.
 */
export const PUBSUB_SERVICE = Symbol.for('PUBSUB_SERVICE');

/**
 * Publisher Redis driver token (the plugin's named client).
 */
export const PUBSUB_PUBLISHER_DRIVER = Symbol.for('PUBSUB_PUBLISHER_DRIVER');

/**
 * Subscriber Redis driver token — a DEDICATED connection, because a Redis
 * connection in subscriber mode cannot execute regular commands.
 */
export const PUBSUB_SUBSCRIBER_DRIVER = Symbol.for('PUBSUB_SUBSCRIBER_DRIVER');

/**
 * Default Pub/Sub configuration.
 * Single source of truth for the plugin's mergeDefaults.
 */
export const DEFAULT_PUBSUB_CONFIG: Required<Omit<IPubSubPluginOptions, 'isGlobal' | 'client'>> = {
  // Empty by default: Pub/Sub channels are often shared with other systems, so
  // an implicit prefix would silently break interop. Set one to namespace.
  channelPrefix: '',
};
