import { describe, it, expect } from 'vitest';
import { StreamsPlugin } from '../../src/streams.plugin';
import { version } from '../../package.json';
import { STREAMS_PLUGIN_OPTIONS, STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE } from '../../src/shared/constants';

describe('StreamsPlugin', () => {
  it('should have correct metadata', () => {
    // Given/When
    const plugin = new StreamsPlugin();

    // Then
    expect(plugin.name).toBe('streams');
    expect(plugin.version).toBe(version);
    expect(plugin.description).toContain('Redis Streams');
  });

  it('should use default configuration', () => {
    // Given
    const plugin = new StreamsPlugin();

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      keyPrefix: 'stream:',
      consumer: {
        batchSize: 10,
        blockTimeout: 5000,
        concurrency: 1,
        maxRetries: 3,
      },
      dlq: {
        enabled: true,
        streamSuffix: ':dlq',
        maxLen: 10000,
      },
    });
  });

  it('should merge custom consumer options', () => {
    // Given
    const plugin = new StreamsPlugin({
      consumer: {
        batchSize: 20,
        blockTimeout: 10000,
      },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.consumer).toMatchObject({
      batchSize: 20,
      blockTimeout: 10000,
      concurrency: 1, // Default preserved
      maxRetries: 3, // Default preserved
    });
  });

  it('should merge custom DLQ options', () => {
    // Given
    const plugin = new StreamsPlugin({
      dlq: {
        enabled: false,
        streamSuffix: ':failed',
      },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.dlq).toMatchObject({
      enabled: false,
      streamSuffix: ':failed',
      maxLen: 10000, // Default preserved
    });
  });

  it('should merge custom retry options', () => {
    // Given
    const plugin = new StreamsPlugin({
      retry: {
        maxRetries: 5,
        initialDelay: 2000,
      },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.retry).toMatchObject({
      maxRetries: 5,
      initialDelay: 2000,
      maxDelay: 30000, // Default preserved
      multiplier: 2, // Default preserved
    });
  });

  it('should merge custom trim options', () => {
    // Given
    const plugin = new StreamsPlugin({
      trim: {
        enabled: false,
        maxLen: 50000,
      },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.trim).toMatchObject({
      enabled: false,
      maxLen: 50000,
      strategy: 'MAXLEN', // Default preserved
      approximate: true, // Default preserved
    });
  });

  it('should use custom key prefix', () => {
    // Given
    const plugin = new StreamsPlugin({ keyPrefix: 'myapp:stream:' });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.keyPrefix).toBe('myapp:stream:');
  });

  it('should provide all required providers', () => {
    // Given
    const plugin = new StreamsPlugin();

    // When
    const providers = plugin.getProviders();

    // Then (Options, Driver, DLQ, Producer, Consumer, Discovery)
    expect(providers).toHaveLength(6);
  });

  it('should export producer, consumer, and DLQ service', () => {
    // Given
    const plugin = new StreamsPlugin();

    // When
    const exports = plugin.getExports();

    // Then
    expect(exports).toContain(STREAM_PRODUCER);
    expect(exports).toContain(STREAM_CONSUMER);
    expect(exports).toContain(DEAD_LETTER_SERVICE);
    expect(exports).toHaveLength(3);
  });

  it('should merge all options together', () => {
    // Given
    const plugin = new StreamsPlugin({
      keyPrefix: 'app:',
      consumer: { batchSize: 15 },
      dlq: { enabled: false },
      retry: { maxRetries: 10 },
      trim: { maxLen: 200000 },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      keyPrefix: 'app:',
      consumer: { batchSize: 15 },
      dlq: { enabled: false },
      retry: { maxRetries: 10 },
      trim: { maxLen: 200000 },
    });
  });
});
