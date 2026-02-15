import { describe, it, expect, vi } from 'vitest';
import { RedisModule, RedisService, CLIENT_MANAGER, REGISTERED_PLUGINS, getClientToken } from '../../src';
import { PluginRegistryService } from '../../src/plugin/application/plugin-registry.service';
import { createMockConnectionConfig } from '../mocks/redis.mock';

// Test configuration
const testConfig = createMockConnectionConfig('ioredis');

describe('RedisModule (Structure)', () => {
  describe('forRoot', () => {
    it('should return DynamicModule', () => {
      // Given
      const config = {
        clients: createMockConnectionConfig('ioredis'),
      };

      // When
      const module = RedisModule.forRoot(config);

      // Then
      expect(module.module).toBe(RedisModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should always be global', () => {
      // Given
      const config = {
        clients: createMockConnectionConfig('ioredis'),
      };

      // When
      const module = RedisModule.forRoot(config);

      // Then
      expect(module.global).toBe(true);
    });

    it('should export RedisService', () => {
      // Given
      const config = {
        clients: createMockConnectionConfig('ioredis'),
      };

      // When
      const module = RedisModule.forRoot(config);

      // Then
      expect(module.exports).toContain(RedisService);
    });

    it('should export CLIENT_MANAGER', () => {
      // Given
      const config = {
        clients: createMockConnectionConfig('ioredis'),
      };

      // When
      const module = RedisModule.forRoot(config);

      // Then
      expect(module.exports).toContain(CLIENT_MANAGER);
    });
  });

  describe('forRootAsync', () => {
    it('should return DynamicModule', () => {
      // Given
      const config = {
        useFactory: () => ({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const module = RedisModule.forRootAsync(config);

      // Then
      expect(module.module).toBe(RedisModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should always be global', () => {
      // Given
      const config = {
        useFactory: () => ({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const module = RedisModule.forRootAsync(config);

      // Then
      expect(module.global).toBe(true);
    });

    it('should include imports', () => {
      // Given
      class ConfigModule {}
      const config = {
        imports: [ConfigModule],
        useFactory: () => ({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const module = RedisModule.forRootAsync(config);

      // Then
      expect(module.imports).toContain(ConfigModule);
    });

    it('should include PluginRegistryService in providers', () => {
      // When
      const module = RedisModule.forRootAsync({
        useFactory: () => ({ clients: testConfig }),
      });

      // Then
      expect(module.providers).toContain(PluginRegistryService);
    });

    it('should include REGISTERED_PLUGINS provider', () => {
      // Given
      const mockPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        getProviders: vi.fn().mockReturnValue([]),
        getExports: vi.fn().mockReturnValue([]),
      };

      // When
      const module = RedisModule.forRootAsync({
        plugins: [mockPlugin],
        useFactory: () => ({ clients: testConfig }),
      });

      // Then
      const registeredPluginsProvider = (module.providers as any[]).find((p: any) => p && p.provide === REGISTERED_PLUGINS);
      expect(registeredPluginsProvider).toBeDefined();
      expect(registeredPluginsProvider.useValue).toEqual([mockPlugin]);
    });
  });

  describe('plugins', () => {
    it('should register plugin providers', () => {
      // Given
      const mockPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        getProviders: vi.fn().mockReturnValue([{ provide: 'TEST_SERVICE', useValue: {} }]),
        getExports: vi.fn().mockReturnValue(['TEST_SERVICE']),
      };

      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
        plugins: [mockPlugin],
      });

      // Then
      expect(mockPlugin.getProviders).toHaveBeenCalled();
      expect(mockPlugin.getExports).toHaveBeenCalled();
      expect(module.providers).toContainEqual({ provide: 'TEST_SERVICE', useValue: {} });
      // Note: Plugin exports are not added to module.exports since RedisModule is @Global()
      // All plugin providers are available for injection everywhere without explicit export
    });

    it('should handle multiple plugins', () => {
      // Given
      const plugin1 = {
        name: 'plugin1',
        version: '1.0.0',
        getProviders: vi.fn().mockReturnValue([{ provide: 'SERVICE1', useValue: {} }]),
        getExports: vi.fn().mockReturnValue(['SERVICE1']),
      };
      const plugin2 = {
        name: 'plugin2',
        version: '1.0.0',
        getProviders: vi.fn().mockReturnValue([{ provide: 'SERVICE2', useValue: {} }]),
        getExports: vi.fn().mockReturnValue(['SERVICE2']),
      };

      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
        plugins: [plugin1, plugin2],
      });

      // Then
      expect(plugin1.getProviders).toHaveBeenCalled();
      expect(plugin2.getProviders).toHaveBeenCalled();
      // Note: Plugin exports are not added to module.exports since RedisModule is @Global()
      // All plugin providers are available for injection everywhere without explicit export
      expect(module.providers).toContainEqual({ provide: 'SERVICE1', useValue: {} });
      expect(module.providers).toContainEqual({ provide: 'SERVICE2', useValue: {} });
    });

    it('should work without plugins', () => {
      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
      });

      // Then
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should include PluginRegistryService in providers', () => {
      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
      });

      // Then
      expect(module.providers).toContain(PluginRegistryService);
    });

    it('should include REGISTERED_PLUGINS provider', () => {
      // Given
      const mockPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        getProviders: vi.fn().mockReturnValue([]),
        getExports: vi.fn().mockReturnValue([]),
      };

      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
        plugins: [mockPlugin],
      });

      // Then
      const registeredPluginsProvider = (module.providers as any[]).find((p: any) => p && p.provide === REGISTERED_PLUGINS);
      expect(registeredPluginsProvider).toBeDefined();
      expect(registeredPluginsProvider.useValue).toEqual([mockPlugin]);
    });

    it('should include REGISTERED_PLUGINS with empty array when no plugins', () => {
      // When
      const module = RedisModule.forRoot({
        clients: testConfig,
      });

      // Then
      const registeredPluginsProvider = (module.providers as any[]).find((p: any) => p && p.provide === REGISTERED_PLUGINS);
      expect(registeredPluginsProvider).toBeDefined();
      expect(registeredPluginsProvider.useValue).toEqual([]);
    });
  });

  describe('global module', () => {
    it('should always be global in forRoot', () => {
      // When
      const module = RedisModule.forRoot({ clients: testConfig });

      // Then
      expect(module.global).toBe(true);
    });

    it('should always be global in forRootAsync', () => {
      // When
      const module = RedisModule.forRootAsync({
        useFactory: () => ({ clients: testConfig }),
      });

      // Then
      expect(module.global).toBe(true);
    });
  });
});
