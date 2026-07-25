import { describe, it, expect, vi } from 'vitest';
import { DiscoveryModule } from '@nestjs/core';
import { PubSubPlugin } from '../../src/pubsub.plugin';
import { version } from '../../package.json';
import { PUBSUB_PLUGIN_OPTIONS, PUBSUB_PUBLISHER_DRIVER, PUBSUB_SERVICE, PUBSUB_SUBSCRIBER_DRIVER } from '../../src/shared/constants';
import type { IPubSubPluginOptions } from '../../src/shared/types';

type FactoryProvider = { provide: unknown; useFactory: (...args: unknown[]) => Promise<unknown>; inject?: unknown[] };

function findProvider(plugin: PubSubPlugin, token: unknown): FactoryProvider {
  return plugin.getProviders().find((p) => typeof p === 'object' && 'provide' in p && p.provide === token) as FactoryProvider;
}

describe('PubSubPlugin', () => {
  describe('plugin metadata', () => {
    it('should expose name, version and description', () => {
      // Given / When
      const plugin = new PubSubPlugin();

      // Then
      expect(plugin.name).toBe('pubsub');
      expect(plugin.version).toBe(version);
      expect(plugin.description).toContain('Pub/Sub');
    });
  });

  describe('configuration', () => {
    it('should default channelPrefix to empty (interop with non-RedisX publishers)', () => {
      // Given / When
      const provider = findProvider(new PubSubPlugin(), PUBSUB_PLUGIN_OPTIONS) as unknown as { useValue: IPubSubPluginOptions };

      // Then
      expect(provider.useValue).toMatchObject({ channelPrefix: '' });
    });

    it('should honor an explicit channelPrefix and client', () => {
      // Given / When
      const provider = findProvider(new PubSubPlugin({ channelPrefix: 'app:', client: 'events' }), PUBSUB_PLUGIN_OPTIONS) as unknown as { useValue: IPubSubPluginOptions };

      // Then
      expect(provider.useValue).toMatchObject({ channelPrefix: 'app:', client: 'events' });
    });

    it('registerAsync should merge defaults over the factory result', async () => {
      // Given
      const plugin = PubSubPlugin.registerAsync({ inject: [], useFactory: () => ({ client: 'events' }) });
      const provider = findProvider(plugin, PUBSUB_PLUGIN_OPTIONS);

      // When
      const resolved = (await provider.useFactory()) as IPubSubPluginOptions;

      // Then
      expect(resolved).toMatchObject({ client: 'events', channelPrefix: '' });
    });
  });

  describe('providers & imports', () => {
    it('should import DiscoveryModule for @Subscribe scanning', () => {
      // Given / When / Then
      expect(new PubSubPlugin().getImports()).toContain(DiscoveryModule);
    });

    it('should register options, publisher, subscriber, service, discovery, and reflector', () => {
      // Given / When
      const providers = new PubSubPlugin().getProviders();
      const tokens = providers.map((p) => (typeof p === 'object' && 'provide' in p ? p.provide : p));

      // Then
      expect(tokens).toContain(PUBSUB_PLUGIN_OPTIONS);
      expect(tokens).toContain(PUBSUB_PUBLISHER_DRIVER);
      expect(tokens).toContain(PUBSUB_SUBSCRIBER_DRIVER);
      expect(tokens).toContain(PUBSUB_SERVICE);
      expect(providers).toHaveLength(6);
    });

    it('should export the service token', () => {
      expect(new PubSubPlugin().getExports()).toContain(PUBSUB_SERVICE);
    });
  });

  describe('publisher driver provider', () => {
    it('should resolve the named client', async () => {
      // Given
      const client = { id: 'pub' };
      const manager = { getClient: vi.fn().mockResolvedValue(client) };

      // When
      const resolved = await findProvider(new PubSubPlugin(), PUBSUB_PUBLISHER_DRIVER).useFactory(manager, undefined, { client: 'events' });

      // Then
      expect(resolved).toBe(client);
      expect(manager.getClient).toHaveBeenCalledWith('events');
    });

    it('should throw a descriptive error when the client is missing', async () => {
      // Given
      const manager = { getClient: vi.fn().mockRejectedValue(new Error('missing')) };

      // When / Then
      await expect(findProvider(new PubSubPlugin(), PUBSUB_PUBLISHER_DRIVER).useFactory(manager, undefined, { client: 'ghost' })).rejects.toThrow('PubSubPlugin: Redis client "ghost" not found');
    });
  });

  describe('subscriber driver provider (dedicated connection)', () => {
    it('should create a dedicated subscriber client cloned from the base config', async () => {
      // Given
      const base = { id: 'base' };
      const dedicated = { id: 'subscriber' };
      const config = { type: 'single', host: 'h', port: 1 };
      const manager = {
        getClient: vi.fn().mockImplementation((name: string) => Promise.resolve(name === 'default' ? base : dedicated)),
        hasClient: vi.fn().mockReturnValue(false),
        getMetadata: vi.fn().mockReturnValue({ config, driverType: 'memory' }),
        createClient: vi.fn().mockResolvedValue(dedicated),
      };

      // When
      const resolved = await findProvider(new PubSubPlugin(), PUBSUB_SUBSCRIBER_DRIVER).useFactory(manager, undefined, {});

      // Then — created once with the SAME connection config AND driver type
      expect(manager.createClient).toHaveBeenCalledWith('default:pubsub-subscriber', config, { driverType: 'memory' });
      expect(resolved).toBe(dedicated);
    });

    it('should reuse an already-created subscriber client', async () => {
      // Given
      const dedicated = { id: 'subscriber' };
      const manager = {
        getClient: vi.fn().mockResolvedValue(dedicated),
        hasClient: vi.fn().mockReturnValue(true),
        getMetadata: vi.fn(),
        createClient: vi.fn(),
      };

      // When
      await findProvider(new PubSubPlugin(), PUBSUB_SUBSCRIBER_DRIVER).useFactory(manager, undefined, {});

      // Then
      expect(manager.createClient).not.toHaveBeenCalled();
    });
  });
});
