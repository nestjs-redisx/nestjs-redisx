import { describe, it, expect } from 'vitest';
import { StreamsPlugin } from '../../src/streams.plugin';
import { version } from '../../package.json';
import { STREAMS_PLUGIN_OPTIONS, STREAM_PRODUCER, STREAM_CONSUMER, DEAD_LETTER_SERVICE, STREAMS_REDIS_DRIVER } from '../../src/shared/constants';
import { CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION } from '@nestjs-redisx/core';

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

  describe('per-plugin client selection', () => {
    it('should include STREAMS_REDIS_DRIVER provider in getProviders()', () => {
      // Given
      const plugin = new StreamsPlugin();

      // When
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_REDIS_DRIVER);

      // Then
      expect(driverProvider).toBeDefined();
      expect(driverProvider).toHaveProperty('useFactory');
      expect((driverProvider as any).inject).toContain(CLIENT_MANAGER);
      expect((driverProvider as any).inject).toContain(REDIS_CLIENTS_INITIALIZATION);
      expect((driverProvider as any).inject).toContain(STREAMS_PLUGIN_OPTIONS);
    });

    it('should use default client name when client option not specified', () => {
      // Given
      const plugin = new StreamsPlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBeUndefined();
    });

    it('should pass custom client name through options', () => {
      // Given
      const plugin = new StreamsPlugin({ client: 'streams-dedicated' });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBe('streams-dedicated');
    });

    it('should work with registerAsync and preserve client option', async () => {
      // Given
      const plugin = StreamsPlugin.registerAsync({
        useFactory: () => ({ client: 'async-streams' }),
      });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_PLUGIN_OPTIONS);
      const config = await (configProvider as any).useFactory();

      // Then
      expect(config.client).toBe('async-streams');
    });

    it('should throw descriptive error when client name is invalid', async () => {
      // Given
      const plugin = new StreamsPlugin({ client: 'nonexistent' });
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === STREAMS_REDIS_DRIVER);
      const factory = (driverProvider as any).useFactory;
      const mockManager = {
        getClient: () => {
          throw new Error('Client not found');
        },
      };

      // When/Then
      await expect(factory(mockManager, undefined, { client: 'nonexistent' })).rejects.toThrow('StreamsPlugin: Redis client "nonexistent" not found');
    });
  });
});
