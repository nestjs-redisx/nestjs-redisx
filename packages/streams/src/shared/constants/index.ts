export const STREAMS_PLUGIN_OPTIONS = Symbol.for('STREAMS_PLUGIN_OPTIONS');
export const STREAM_PRODUCER = Symbol.for('STREAM_PRODUCER');
export const STREAM_CONSUMER = Symbol.for('STREAM_CONSUMER');
export const DEAD_LETTER_SERVICE = Symbol.for('DEAD_LETTER_SERVICE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const STREAMS_REDIS_DRIVER = Symbol.for('STREAMS_REDIS_DRIVER');
