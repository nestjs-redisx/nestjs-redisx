// Plugin
export { PubSubPlugin } from './pubsub.plugin';

// Services
export { PubSubService } from './pubsub/application/services/pubsub.service';

// Ports (Interfaces)
export type { IPubSubService } from './pubsub/application/ports/pubsub-service.port';

// Decorators
export { Subscribe, PUBSUB_SUBSCRIBE_METADATA, type ISubscribeOptions } from './pubsub/api/decorators/subscribe.decorator';

// Types
export type { IPubSubPluginOptions, IPubSubMessage, IPubSubSubscription, IPubSubSubscriptionsSnapshot, PubSubMessageHandler, PubSubPluginOptions, PubSubMessage } from './shared/types';

// Errors
export { PubSubError, PubSubPublishError, PubSubSubscribeError } from './shared/errors';

// Constants (DI tokens)
export { PUBSUB_PLUGIN_OPTIONS, PUBSUB_SERVICE, PUBSUB_PUBLISHER_DRIVER, PUBSUB_SUBSCRIBER_DRIVER } from './shared/constants';
