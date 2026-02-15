import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleRef } from '@nestjs/core';

import { PluginRegistryService } from '../../src/plugin/application/plugin-registry.service';
import { IRedisXPlugin, IPluginContext } from '../../src/plugin/domain/interfaces';
import { RedisClientManager } from '../../src/client';
import { IRedisModuleOptions } from '../../src/types';

function createMockPlugin(overrides: Partial<IRedisXPlugin> & { name: string }): IRedisXPlugin {
  return {
    version: '1.0.0',
    ...overrides,
  };
}

function createMockClientManager(): RedisClientManager {
  return {
    hasClient: vi.fn().mockReturnValue(true),
    getClient: vi.fn().mockResolvedValue({}),
    getClientNames: vi.fn().mockReturnValue(['default']),
  } as unknown as RedisClientManager;
}

function createMockModuleRef(): ModuleRef {
  return {
    get: vi.fn(),
  } as unknown as ModuleRef;
}

function createService(plugins: IRedisXPlugin[], options?: Partial<IRedisModuleOptions>): PluginRegistryService {
  const clientManager = createMockClientManager();
  const moduleRef = createMockModuleRef();
  const moduleOptions: IRedisModuleOptions = {
    clients: { type: 'single', host: 'localhost', port: 6379 },
    ...options,
  };

  return new PluginRegistryService(plugins, clientManager, moduleOptions, moduleRef);
}

describe('PluginRegistryService', () => {
  describe('onModuleInit', () => {
    it('should call onRegister on all plugins', async () => {
      // Given
      const onRegister1 = vi.fn();
      const onRegister2 = vi.fn();
      const plugins = [createMockPlugin({ name: 'plugin-a', onRegister: onRegister1 }), createMockPlugin({ name: 'plugin-b', onRegister: onRegister2 })];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      expect(onRegister1).toHaveBeenCalledTimes(1);
      expect(onRegister2).toHaveBeenCalledTimes(1);
    });

    it('should call onModuleInit on all plugins', async () => {
      // Given
      const onModuleInit1 = vi.fn();
      const onModuleInit2 = vi.fn();
      const plugins = [createMockPlugin({ name: 'plugin-a', onModuleInit: onModuleInit1 }), createMockPlugin({ name: 'plugin-b', onModuleInit: onModuleInit2 })];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      expect(onModuleInit1).toHaveBeenCalledTimes(1);
      expect(onModuleInit2).toHaveBeenCalledTimes(1);
    });

    it('should call onRegister before onModuleInit', async () => {
      // Given
      const callOrder: string[] = [];
      const plugins = [
        createMockPlugin({
          name: 'plugin-a',
          onRegister: vi.fn(() => {
            callOrder.push('register-a');
          }),
          onModuleInit: vi.fn(() => {
            callOrder.push('init-a');
          }),
        }),
        createMockPlugin({
          name: 'plugin-b',
          onRegister: vi.fn(() => {
            callOrder.push('register-b');
          }),
          onModuleInit: vi.fn(() => {
            callOrder.push('init-b');
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      expect(callOrder).toEqual(['register-a', 'register-b', 'init-a', 'init-b']);
    });

    it('should skip plugins without hooks', async () => {
      // Given
      const plugins = [
        createMockPlugin({ name: 'no-hooks' }),
        createMockPlugin({
          name: 'with-hooks',
          onRegister: vi.fn(),
          onModuleInit: vi.fn(),
        }),
      ];
      const service = createService(plugins);

      // When/Then — should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(plugins[1].onRegister).toHaveBeenCalledTimes(1);
      expect(plugins[1].onModuleInit).toHaveBeenCalledTimes(1);
    });

    it('should work with empty plugins array', async () => {
      // Given
      const service = createService([]);

      // When/Then — should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('should pass IPluginContext to hooks', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const plugins = [
        createMockPlugin({
          name: 'test-plugin',
          onRegister: vi.fn((ctx) => {
            receivedContext = ctx;
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      expect(receivedContext).toBeDefined();
      expect(receivedContext!.clientManager).toBeDefined();
      expect(receivedContext!.config).toBeDefined();
      expect(receivedContext!.logger).toBeDefined();
      expect(receivedContext!.moduleRef).toBeDefined();
      expect(typeof receivedContext!.getPlugin).toBe('function');
      expect(typeof receivedContext!.hasPlugin).toBe('function');
    });

    it('should provide working getPlugin and hasPlugin in context', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const pluginA = createMockPlugin({ name: 'plugin-a' });
      const pluginB = createMockPlugin({
        name: 'plugin-b',
        onRegister: vi.fn((ctx) => {
          receivedContext = ctx;
        }),
      });
      const service = createService([pluginA, pluginB]);

      // When
      await service.onModuleInit();

      // Then
      expect(receivedContext!.hasPlugin('plugin-a')).toBe(true);
      expect(receivedContext!.hasPlugin('nonexistent')).toBe(false);
      expect(receivedContext!.getPlugin('plugin-a')).toBe(pluginA);
      expect(receivedContext!.getPlugin('nonexistent')).toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call onModuleDestroy on all plugins in reverse order', async () => {
      // Given
      const callOrder: string[] = [];
      const plugins = [
        createMockPlugin({
          name: 'plugin-a',
          onModuleDestroy: vi.fn(() => {
            callOrder.push('destroy-a');
          }),
        }),
        createMockPlugin({
          name: 'plugin-b',
          onModuleDestroy: vi.fn(() => {
            callOrder.push('destroy-b');
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleDestroy();

      // Then
      expect(callOrder).toEqual(['destroy-b', 'destroy-a']);
    });

    it('should work with empty plugins array', async () => {
      // Given
      const service = createService([]);

      // When/Then
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('should skip plugins without onModuleDestroy', async () => {
      // Given
      const plugins = [
        createMockPlugin({ name: 'no-destroy' }),
        createMockPlugin({
          name: 'with-destroy',
          onModuleDestroy: vi.fn(),
        }),
      ];
      const service = createService(plugins);

      // When/Then
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(plugins[1].onModuleDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('sortByDependencies', () => {
    it('should respect dependency order (B depends on A → A first)', async () => {
      // Given
      const callOrder: string[] = [];
      const plugins = [
        createMockPlugin({
          name: 'plugin-b',
          dependencies: ['plugin-a'],
          onRegister: vi.fn(() => {
            callOrder.push('register-b');
          }),
        }),
        createMockPlugin({
          name: 'plugin-a',
          onRegister: vi.fn(() => {
            callOrder.push('register-a');
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      expect(callOrder).toEqual(['register-a', 'register-b']);
    });

    it('should handle chain dependencies (C → B → A)', async () => {
      // Given
      const plugins = [createMockPlugin({ name: 'plugin-c', dependencies: ['plugin-b'] }), createMockPlugin({ name: 'plugin-a' }), createMockPlugin({ name: 'plugin-b', dependencies: ['plugin-a'] })];
      const service = createService(plugins);

      // When
      const sorted = service.sortByDependencies(plugins);

      // Then
      const names = sorted.map((p) => p.name);
      expect(names.indexOf('plugin-a')).toBeLessThan(names.indexOf('plugin-b'));
      expect(names.indexOf('plugin-b')).toBeLessThan(names.indexOf('plugin-c'));
    });

    it('should throw on circular dependencies', () => {
      // Given
      const plugins = [createMockPlugin({ name: 'plugin-a', dependencies: ['plugin-b'] }), createMockPlugin({ name: 'plugin-b', dependencies: ['plugin-a'] })];
      const service = createService(plugins);

      // When/Then
      expect(() => service.sortByDependencies(plugins)).toThrow(/Circular dependency detected/);
    });

    it('should throw on missing dependency', () => {
      // Given
      const plugins = [createMockPlugin({ name: 'plugin-a', dependencies: ['nonexistent'] })];
      const service = createService(plugins);

      // When/Then
      expect(() => service.sortByDependencies(plugins)).toThrow(/depends on "nonexistent" which is not registered/);
    });

    it('should preserve original order for plugins without dependencies', () => {
      // Given
      const plugins = [createMockPlugin({ name: 'plugin-c' }), createMockPlugin({ name: 'plugin-a' }), createMockPlugin({ name: 'plugin-b' })];
      const service = createService(plugins);

      // When
      const sorted = service.sortByDependencies(plugins);

      // Then
      expect(sorted.map((p) => p.name)).toEqual(['plugin-c', 'plugin-a', 'plugin-b']);
    });

    it('should return copy for single plugin', () => {
      // Given
      const plugins = [createMockPlugin({ name: 'only' })];
      const service = createService(plugins);

      // When
      const sorted = service.sortByDependencies(plugins);

      // Then
      expect(sorted).toEqual(plugins);
      expect(sorted).not.toBe(plugins); // Should be a copy
    });

    it('should return empty array for empty input', () => {
      // Given
      const service = createService([]);

      // When
      const sorted = service.sortByDependencies([]);

      // Then
      expect(sorted).toEqual([]);
    });

    it('should handle diamond dependencies (D → B,C → A)', () => {
      // Given
      const plugins = [createMockPlugin({ name: 'plugin-d', dependencies: ['plugin-b', 'plugin-c'] }), createMockPlugin({ name: 'plugin-b', dependencies: ['plugin-a'] }), createMockPlugin({ name: 'plugin-c', dependencies: ['plugin-a'] }), createMockPlugin({ name: 'plugin-a' })];
      const service = createService(plugins);

      // When
      const sorted = service.sortByDependencies(plugins);

      // Then
      const names = sorted.map((p) => p.name);
      expect(names.indexOf('plugin-a')).toBeLessThan(names.indexOf('plugin-b'));
      expect(names.indexOf('plugin-a')).toBeLessThan(names.indexOf('plugin-c'));
      expect(names.indexOf('plugin-b')).toBeLessThan(names.indexOf('plugin-d'));
      expect(names.indexOf('plugin-c')).toBeLessThan(names.indexOf('plugin-d'));
    });
  });

  describe('onModuleDestroy with dependencies', () => {
    it('should destroy in reverse dependency order', async () => {
      // Given
      const callOrder: string[] = [];
      const plugins = [
        createMockPlugin({
          name: 'plugin-b',
          dependencies: ['plugin-a'],
          onModuleDestroy: vi.fn(() => {
            callOrder.push('destroy-b');
          }),
        }),
        createMockPlugin({
          name: 'plugin-a',
          onModuleDestroy: vi.fn(() => {
            callOrder.push('destroy-a');
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleDestroy();

      // Then
      // A comes before B in sorted order, so reverse = B first
      expect(callOrder).toEqual(['destroy-b', 'destroy-a']);
    });
  });

  describe('context config', () => {
    it('should include global config from module options', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const plugins = [
        createMockPlugin({
          name: 'test',
          onRegister: vi.fn((ctx) => {
            receivedContext = ctx;
          }),
        }),
      ];
      const service = createService(plugins, {
        global: { debug: true, defaultTtl: 300, keyPrefix: 'test:' },
      });

      // When
      await service.onModuleInit();

      // Then
      expect(receivedContext!.config.global?.debug).toBe(true);
      expect(receivedContext!.config.global?.defaultTtl).toBe(300);
      expect(receivedContext!.config.global?.keyPrefix).toBe('test:');
    });

    it('should include plugins list in config', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const pluginA = createMockPlugin({ name: 'plugin-a' });
      const pluginB = createMockPlugin({
        name: 'plugin-b',
        onRegister: vi.fn((ctx) => {
          receivedContext = ctx;
        }),
      });
      const service = createService([pluginA, pluginB]);

      // When
      await service.onModuleInit();

      // Then
      expect(receivedContext!.config.plugins).toContain(pluginA);
      expect(receivedContext!.config.plugins).toContain(pluginB);
    });
  });

  describe('context clientManager', () => {
    it('should delegate hasClient to real client manager', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const plugins = [
        createMockPlugin({
          name: 'test',
          onRegister: vi.fn((ctx) => {
            receivedContext = ctx;
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();

      // Then
      receivedContext!.clientManager.hasClient('default');
      // hasClient is mocked to return true
      expect(receivedContext!.clientManager.hasClient('default')).toBe(true);
    });

    it('should delegate getClient to real client manager', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const plugins = [
        createMockPlugin({
          name: 'test',
          onRegister: vi.fn((ctx) => {
            receivedContext = ctx;
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();
      const result = await receivedContext!.clientManager.getClient('default');

      // Then
      expect(result).toBeDefined();
    });

    it('should delegate getClientNames to real client manager', async () => {
      // Given
      let receivedContext: IPluginContext | undefined;
      const plugins = [
        createMockPlugin({
          name: 'test',
          onRegister: vi.fn((ctx) => {
            receivedContext = ctx;
          }),
        }),
      ];
      const service = createService(plugins);

      // When
      await service.onModuleInit();
      const names = receivedContext!.clientManager.getClientNames();

      // Then
      expect(names).toEqual(['default']);
    });
  });
});
