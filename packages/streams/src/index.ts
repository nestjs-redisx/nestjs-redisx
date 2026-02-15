// Plugin
export { StreamsPlugin } from './streams.plugin';

// Services
export { StreamProducerService } from './streams/application/services/stream-producer.service';
export { StreamConsumerService } from './streams/application/services/stream-consumer.service';
export { DeadLetterService } from './streams/application/services/dead-letter.service';

// Ports (Interfaces)
export type { IStreamProducer } from './streams/application/ports/stream-producer.port';
export type { IStreamConsumer } from './streams/application/ports/stream-consumer.port';
export type { IDeadLetterService } from './streams/application/ports/dead-letter.port';

// Entities
export { StreamMessage } from './streams/domain/entities/stream-message.entity';

// Decorators
export { StreamConsumer, STREAM_CONSUMER_METADATA } from './streams/api/decorators/stream-consumer.decorator';

// Types
export type { IStreamsPluginOptions, IStreamsPluginOptions as StreamsPluginOptions, IStreamMessage, PublishOptions, StreamInfo, ConsumeOptions, ConsumerHandle, PendingInfo, MessageHandler, DlqMessage, StreamConsumerOptions } from './shared/types';

// Errors
export { StreamError, StreamPublishError, StreamConsumeError, StreamGroupError } from './shared/errors';

// Constants
export { STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE, STREAMS_PLUGIN_OPTIONS } from './shared/constants';
