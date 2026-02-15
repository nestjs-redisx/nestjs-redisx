/**
 * Unit tests for Redis providers.
 *
 * Tests the provider factory functions that create NestJS DI providers
 * for Redis module initialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRedisProviders, createAsyncProviders, createFeatureProviders } from '../../src/application/redis.providers';
import type { IRedisModuleOptions, IRedisModuleAsyncOptions, IRedisModuleOptionsFactory, ConnectionConfig } from '../../src/types';
import { RedisClientManager } from '../../src/client';
import { REDIS_MODULE_OPTIONS, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, getClientToken, DEFAULT_CLIENT_NAME } from '../../src/shared/constants';
import { createMockConnectionConfig } from '../mocks/redis.mock';

describe('Redis Providers', () => {
  describe('createRedisProviders', () => {
    it('should create providers for single connection', () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const options: IRedisModuleOptions = {
        clients: config,
      };

      // When
      const providers = createRedisProviders(options);

      // Then
      expect(providers).toHaveLength(4); // options + manager + default client + health indicator
      expect(providers[0]).toEqual({
        provide: REDIS_MODULE_OPTIONS,
        useValue: options,
      });
      expect(providers[1]).toHaveProperty('provide', CLIENT_MANAGER);
      expect(providers[1]).toHaveProperty('useFactory');
    });

    it('should create providers for multiple connections', () => {
      // Given
      const options: IRedisModuleOptions = {
        clients: {
          cache: createMockConnectionConfig('ioredis'),
          sessions: createMockConnectionConfig('ioredis'),
          queue: createMockConnectionConfig('ioredis'),
        },
      };

      // When
      const providers = createRedisProviders(options);

      // Then
      expect(providers).toHaveLength(6); // options + manager + 3 clients + health indicator
      expect(providers[0]).toEqual({
        provide: REDIS_MODULE_OPTIONS,
        useValue: options,
      });
      expect(providers[1]).toHaveProperty('provide', CLIENT_MANAGER);
      // Check client providers were created
      expect(providers[2]).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(providers[3]).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(providers[4]).toHaveProperty('inject', [CLIENT_MANAGER]);
    });

    it('should create client manager provider with factory', () => {
      // Given
      const options: IRedisModuleOptions = {
        clients: createMockConnectionConfig('ioredis'),
      };

      // When
      const providers = createRedisProviders(options);
      const managerProvider = providers[1];

      // Then
      expect(managerProvider.provide).toBe(CLIENT_MANAGER);
      expect(managerProvider).toHaveProperty('useFactory');

      // Execute factory to verify it creates RedisClientManager
      const factory = (managerProvider as any).useFactory;
      const manager = factory();
      expect(manager).toBeInstanceOf(RedisClientManager);
    });

    it('should create default client provider for single connection', () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const options: IRedisModuleOptions = {
        clients: config,
      };

      // When
      const providers = createRedisProviders(options);
      const clientProvider = providers[2];

      // Then
      const expectedToken = getClientToken(DEFAULT_CLIENT_NAME);
      expect(clientProvider).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(clientProvider).toHaveProperty('useFactory');
    });

    it('should create named client providers for multiple connections', () => {
      // Given
      const options: IRedisModuleOptions = {
        clients: {
          cache: createMockConnectionConfig('ioredis'),
          sessions: createMockConnectionConfig('ioredis'),
        },
      };

      // When
      const providers = createRedisProviders(options);

      // Then
      // Skip first 2 (options + manager), check the client providers
      const cacheProvider = providers[2];
      const sessionsProvider = providers[3];

      expect(cacheProvider).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(cacheProvider).toHaveProperty('useFactory');

      expect(sessionsProvider).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(sessionsProvider).toHaveProperty('useFactory');
    });

    it('should handle empty clients object', () => {
      // Given
      const options: IRedisModuleOptions = {
        clients: {},
      };

      // When
      const providers = createRedisProviders(options);

      // Then
      expect(providers).toHaveLength(3); // options + manager + health indicator (no client providers)
    });
  });

  describe('createAsyncProviders', () => {
    describe('useFactory', () => {
      it('should create providers with useFactory', () => {
        // Given
        const factory = vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        });
        const options: IRedisModuleAsyncOptions = {
          useFactory: factory,
          inject: ['ConfigService'],
        };

        // When
        const providers = createAsyncProviders(options);

        // Then
        // Should include: manager + options provider + async client providers (2)
        expect(providers.length).toBeGreaterThanOrEqual(3);

        // Find options provider
        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
        expect(optionsProvider).toBeDefined();
        expect((optionsProvider as any).useFactory).toBe(factory);
        expect((optionsProvider as any).inject).toEqual(['ConfigService']);
      });

      it('should use empty inject array when inject not provided', () => {
        // Given
        const factory = vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        });
        const options: IRedisModuleAsyncOptions = {
          useFactory: factory,
        };

        // When
        const providers = createAsyncProviders(options);

        // Then
        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
        expect((optionsProvider as any).inject).toEqual([]);
      });
    });

    describe('useExisting', () => {
      it('should create providers with useExisting', () => {
        // Given
        class ConfigService implements IRedisModuleOptionsFactory {
          async createRedisModuleOptions(): Promise<IRedisModuleOptions> {
            return {
              clients: createMockConnectionConfig('ioredis'),
            };
          }
        }

        const options: IRedisModuleAsyncOptions = {
          useExisting: ConfigService,
        };

        // When
        const providers = createAsyncProviders(options);

        // Then
        expect(providers.length).toBeGreaterThanOrEqual(3);

        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
        expect(optionsProvider).toBeDefined();
        expect((optionsProvider as any).inject).toEqual([ConfigService]);
        expect((optionsProvider as any).useFactory).toBeDefined();
      });

      it('should create factory that calls createRedisOptions', async () => {
        // Given
        const mockFactory: IRedisModuleOptionsFactory = {
          createRedisModuleOptions: vi.fn().mockResolvedValue({
            clients: createMockConnectionConfig('ioredis'),
          }),
        };

        class ConfigService {}
        const options: IRedisModuleAsyncOptions = {
          useExisting: ConfigService,
        };

        // When
        const providers = createAsyncProviders(options);
        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS) as any;

        // Execute the factory
        const result = await optionsProvider.useFactory(mockFactory);

        // Then
        expect(mockFactory.createRedisModuleOptions).toHaveBeenCalled();
        expect(result).toHaveProperty('clients');
      });
    });

    describe('useClass', () => {
      it('should create providers with useClass', () => {
        // Given
        class ConfigService implements IRedisModuleOptionsFactory {
          async createRedisModuleOptions(): Promise<IRedisModuleOptions> {
            return {
              clients: createMockConnectionConfig('ioredis'),
            };
          }
        }

        const options: IRedisModuleAsyncOptions = {
          useClass: ConfigService,
        };

        // When
        const providers = createAsyncProviders(options);

        // Then
        // Should include: manager + class provider + options provider + async client providers
        expect(providers.length).toBeGreaterThanOrEqual(4);

        // Find class provider
        const classProvider = providers.find((p: any) => p.provide === ConfigService);
        expect(classProvider).toBeDefined();
        expect((classProvider as any).useClass).toBe(ConfigService);

        // Find options provider
        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
        expect(optionsProvider).toBeDefined();
        expect((optionsProvider as any).inject).toEqual([ConfigService]);
      });

      it('should create factory that calls createRedisOptions for useClass', async () => {
        // Given
        const mockFactory: IRedisModuleOptionsFactory = {
          createRedisModuleOptions: vi.fn().mockResolvedValue({
            clients: createMockConnectionConfig('ioredis'),
          }),
        };

        class ConfigService {}
        const options: IRedisModuleAsyncOptions = {
          useClass: ConfigService,
        };

        // When
        const providers = createAsyncProviders(options);
        const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS) as any;

        // Execute the factory
        const result = await optionsProvider.useFactory(mockFactory);

        // Then
        expect(mockFactory.createRedisModuleOptions).toHaveBeenCalled();
        expect(result).toHaveProperty('clients');
      });
    });

    it('should always create client manager provider', () => {
      // Given
      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const providers = createAsyncProviders(options);

      // Then
      const managerProvider = providers.find((p: any) => p.provide === CLIENT_MANAGER);
      expect(managerProvider).toBeDefined();
      expect((managerProvider as any).useFactory).toBeDefined();
    });

    it('should create async client providers', () => {
      // Given
      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const providers = createAsyncProviders(options);

      // Then
      // Should include initialization provider
      const initProvider = providers.find((p: any) => p.provide === REDIS_CLIENTS_INITIALIZATION);
      expect(initProvider).toBeDefined();
      expect((initProvider as any).inject).toEqual([REDIS_MODULE_OPTIONS, CLIENT_MANAGER]);

      // Should include default client provider
      const clientProviders = providers.filter((p: any) => typeof p.provide === 'symbol' && p.provide.toString().includes('REDIS_CLIENT'));
      expect(clientProviders.length).toBeGreaterThan(0);
    });
  });

  describe('createFeatureProviders', () => {
    it('should create provider for named client', () => {
      // Given
      const clientName = 'cache';

      // When
      const providers = createFeatureProviders(clientName);

      // Then
      expect(providers).toHaveLength(1);
      expect(providers[0]).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(providers[0]).toHaveProperty('useFactory');
    });

    it('should create provider that calls manager.getClient', async () => {
      // Given
      const clientName = 'sessions';
      const mockDriver = { ping: vi.fn() };
      const mockManager = {
        getClient: vi.fn().mockResolvedValue(mockDriver),
      };

      // When
      const providers = createFeatureProviders(clientName);
      const provider = providers[0] as any;

      // Execute factory
      const result = await provider.useFactory(mockManager);

      // Then
      expect(mockManager.getClient).toHaveBeenCalledWith(clientName);
      expect(result).toBe(mockDriver);
    });

    it('should create different providers for different names', () => {
      // Given
      const name1 = 'cache';
      const name2 = 'sessions';

      // When
      const providers1 = createFeatureProviders(name1);
      const providers2 = createFeatureProviders(name2);

      // Then
      // Providers are different objects
      expect(providers1).not.toBe(providers2);

      // But have same structure
      expect(providers1).toHaveLength(1);
      expect(providers2).toHaveLength(1);
      expect(providers1[0]).toHaveProperty('inject', [CLIENT_MANAGER]);
      expect(providers2[0]).toHaveProperty('inject', [CLIENT_MANAGER]);
    });

    it('should handle special characters in client name', async () => {
      // Given
      const specialNames = ['cache:v2', 'user-sessions', 'db_primary'];

      for (const name of specialNames) {
        const mockManager = {
          getClient: vi.fn().mockResolvedValue({ ping: vi.fn() }),
        };

        // When
        const providers = createFeatureProviders(name);
        const result = await (providers[0] as any).useFactory(mockManager);

        // Then
        expect(mockManager.getClient).toHaveBeenCalledWith(name);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should create providers even without explicit async option', () => {
      // Given - options without useFactory, useExisting, or useClass
      // This is a weird edge case, but the code allows it
      const options = {} as IRedisModuleAsyncOptions;

      // When
      const providers = createAsyncProviders(options);

      // Then
      // Should at least create manager and async client providers
      expect(providers.length).toBeGreaterThanOrEqual(3);

      const managerProvider = providers.find((p: any) => p.provide === CLIENT_MANAGER);
      expect(managerProvider).toBeDefined();
    });

    it('should handle single connection in async providers', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const mockManager = {
        createClient: vi.fn().mockResolvedValue({ ping: vi.fn() }),
        getClient: vi.fn().mockResolvedValue({ ping: vi.fn() }),
      };

      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: config,
        }),
      };

      // When
      const providers = createAsyncProviders(options);

      // Find init provider
      const initProvider = providers.find((p: any) => p.provide === REDIS_CLIENTS_INITIALIZATION) as any;

      // Execute initialization with single connection
      const moduleOptions = { clients: config };
      await initProvider.useFactory(moduleOptions, mockManager);

      // Then
      expect(mockManager.createClient).toHaveBeenCalledWith(DEFAULT_CLIENT_NAME, config, { driverType: 'ioredis' });
    });

    it('should handle multiple connections in async providers', async () => {
      // Given
      const configs = {
        cache: createMockConnectionConfig('ioredis'),
        sessions: createMockConnectionConfig('ioredis'),
      };
      const mockManager = {
        createClient: vi.fn().mockResolvedValue({ ping: vi.fn() }),
        getClient: vi.fn().mockResolvedValue({ ping: vi.fn() }),
      };

      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: configs,
        }),
      };

      // When
      const providers = createAsyncProviders(options);

      // Find init provider
      const initProvider = providers.find((p: any) => p.provide === REDIS_CLIENTS_INITIALIZATION) as any;

      // Execute initialization with multiple connections
      const moduleOptions = { clients: configs };
      await initProvider.useFactory(moduleOptions, mockManager);

      // Then
      expect(mockManager.createClient).toHaveBeenCalledTimes(2);
      expect(mockManager.createClient).toHaveBeenCalledWith('cache', configs.cache, { driverType: 'ioredis' });
      expect(mockManager.createClient).toHaveBeenCalledWith('sessions', configs.sessions, { driverType: 'ioredis' });
    });

    it('should create default client provider in async mode', async () => {
      // Given
      const mockDriver = { ping: vi.fn() };
      const mockManager = {
        getClient: vi.fn().mockResolvedValue(mockDriver),
      };

      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        }),
      };

      // When
      const providers = createAsyncProviders(options);

      // Find default client provider
      const clientProvider = providers.find((p: any) => p.inject?.includes(REDIS_CLIENTS_INITIALIZATION)) as any;

      expect(clientProvider).toBeDefined();

      // Execute factory
      const result = await clientProvider.useFactory(mockManager);

      // Then
      expect(mockManager.getClient).toHaveBeenCalledWith(DEFAULT_CLIENT_NAME);
      expect(result).toBe(mockDriver);
    });

    it('should handle both useFactory and useClass together', () => {
      // Given
      class ConfigService implements IRedisModuleOptionsFactory {
        async createRedisModuleOptions(): Promise<IRedisModuleOptions> {
          return { clients: createMockConnectionConfig('ioredis') };
        }
      }

      const factory = vi.fn().mockResolvedValue({
        clients: createMockConnectionConfig('ioredis'),
      });

      // When both are provided, useFactory takes precedence in createAsyncOptionsProvider
      const options: IRedisModuleAsyncOptions = {
        useClass: ConfigService,
        useFactory: factory,
      };

      // When
      const providers = createAsyncProviders(options);

      // Then
      // useClass creates class provider
      const classProvider = providers.find((p: any) => p.provide === ConfigService);
      expect(classProvider).toBeDefined();

      // But useFactory is used for options provider (takes precedence in createAsyncOptionsProvider)
      const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS) as any;
      expect(optionsProvider.useFactory).toBe(factory);
    });

    it('should handle both useExisting and useFactory together', () => {
      // Given
      class ConfigService {}

      const factory = vi.fn().mockResolvedValue({
        clients: createMockConnectionConfig('ioredis'),
      });

      // When both are provided, useFactory takes precedence
      const options: IRedisModuleAsyncOptions = {
        useExisting: ConfigService,
        useFactory: factory,
      };

      // When
      const providers = createAsyncProviders(options);

      // Then
      // useFactory takes precedence
      const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS) as any;

      expect(optionsProvider.useFactory).toBe(factory);
      expect(optionsProvider.inject).toEqual([]);
    });
  });

  describe('Integration', () => {
    it('should create complete provider set for sync module', () => {
      // Given
      const options: IRedisModuleOptions = {
        clients: {
          cache: createMockConnectionConfig('ioredis'),
          sessions: createMockConnectionConfig('ioredis'),
        },
      };

      // When
      const providers = createRedisProviders(options);

      // Then
      // Verify all required providers are present
      const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
      const managerProvider = providers.find((p: any) => p.provide === CLIENT_MANAGER);

      expect(optionsProvider).toBeDefined();
      expect(managerProvider).toBeDefined();

      // Client providers should exist
      const clientProviders = providers.filter((p: any) => p.inject?.includes(CLIENT_MANAGER) && p.useFactory);
      expect(clientProviders.length).toBe(3);
    });

    it('should create complete provider set for async module', () => {
      // Given
      const options: IRedisModuleAsyncOptions = {
        useFactory: vi.fn().mockResolvedValue({
          clients: createMockConnectionConfig('ioredis'),
        }),
        inject: ['ConfigService'],
      };

      // When
      const providers = createAsyncProviders(options);

      // Then
      const managerProvider = providers.find((p: any) => p.provide === CLIENT_MANAGER);
      const optionsProvider = providers.find((p: any) => p.provide === REDIS_MODULE_OPTIONS);
      const initProvider = providers.find((p: any) => p.provide === REDIS_CLIENTS_INITIALIZATION);

      expect(managerProvider).toBeDefined();
      expect(optionsProvider).toBeDefined();
      expect(initProvider).toBeDefined();
    });
  });
});
