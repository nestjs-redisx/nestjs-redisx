import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDriver, createDrivers, detectAvailableDriver, getRecommendedDriver, DriverFactory } from '../../src/driver/application/driver.factory';
import { IoRedisAdapter } from '../../src/driver/infrastructure/ioredis.adapter';
import { NodeRedisAdapter } from '../../src/driver/infrastructure/node-redis.adapter';
import { ConnectionConfig } from '../../src/types';

describe('DriverFactory', () => {
  let singleConfig: ConnectionConfig;
  let clusterConfig: ConnectionConfig;
  let sentinelConfig: ConnectionConfig;

  beforeEach(() => {
    singleConfig = {
      type: 'single',
      host: 'localhost',
      port: 6379,
    };

    clusterConfig = {
      type: 'cluster',
      nodes: [
        { host: 'localhost', port: 7000 },
        { host: 'localhost', port: 7001 },
      ],
    };

    sentinelConfig = {
      type: 'sentinel',
      sentinels: [{ host: 'localhost', port: 26379 }],
      name: 'mymaster',
    };
  });

  describe('createDriver', () => {
    describe('IoRedis driver', () => {
      it('should create IoRedis driver for single connection', () => {
        // When
        const driver = createDriver(singleConfig, { type: 'ioredis' });

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
      });

      it('should create IoRedis driver for cluster connection', () => {
        // When
        const driver = createDriver(clusterConfig, { type: 'ioredis' });

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
      });

      it('should create IoRedis driver for sentinel connection', () => {
        // When
        const driver = createDriver(sentinelConfig, { type: 'ioredis' });

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
      });

      it('should create IoRedis driver by default', () => {
        // When
        const driver = createDriver(singleConfig);

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
      });

      it('should pass enableLogging option to driver', () => {
        // When
        const driver = createDriver(singleConfig, {
          type: 'ioredis',
          enableLogging: true,
        });

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
        expect(driver['enableLogging']).toBe(true);
      });
    });

    describe('NodeRedis driver', () => {
      it('should create NodeRedis driver for single connection', () => {
        // When
        const driver = createDriver(singleConfig, { type: 'node-redis' });

        // Then
        expect(driver).toBeInstanceOf(NodeRedisAdapter);
      });

      it('should create NodeRedis driver for cluster connection', () => {
        // When
        const driver = createDriver(clusterConfig, { type: 'node-redis' });

        // Then
        expect(driver).toBeInstanceOf(NodeRedisAdapter);
      });

      it('should create NodeRedis driver for sentinel connection', () => {
        // When
        const driver = createDriver(sentinelConfig, { type: 'node-redis' });

        // Then
        expect(driver).toBeInstanceOf(NodeRedisAdapter);
      });
    });

    it('should throw error for unknown driver type', () => {
      // When & Then
      expect(() => createDriver(singleConfig, { type: 'unknown' as never })).toThrow('Unsupported driver type');
    });
  });

  describe('createDrivers', () => {
    it('should create multiple drivers with default type', () => {
      // Given
      const configs = {
        cache: singleConfig,
        session: { ...singleConfig, db: 1 } as ConnectionConfig,
      };

      // When
      const drivers = createDrivers(configs);

      // Then
      expect(drivers.cache).toBeInstanceOf(IoRedisAdapter);
      expect(drivers.session).toBeInstanceOf(IoRedisAdapter);
    });

    it('should create multiple drivers with specified type', () => {
      // Given
      const configs = {
        cache: singleConfig,
        session: { ...singleConfig, db: 1 } as ConnectionConfig,
      };

      // When
      const drivers = createDrivers(configs, { type: 'node-redis' });

      // Then
      expect(drivers.cache).toBeInstanceOf(NodeRedisAdapter);
      expect(drivers.session).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should create multiple drivers with different config types', () => {
      // Given
      const configs = {
        single: singleConfig,
        cluster: clusterConfig,
        sentinel: sentinelConfig,
      };

      // When
      const drivers = createDrivers(configs);

      // Then
      expect(drivers.single).toBeInstanceOf(IoRedisAdapter);
      expect(drivers.cluster).toBeInstanceOf(IoRedisAdapter);
      expect(drivers.sentinel).toBeInstanceOf(IoRedisAdapter);
    });

    it('should create empty object for empty configs', () => {
      // Given
      const configs = {};

      // When
      const drivers = createDrivers(configs);

      // Then
      expect(drivers).toEqual({});
    });
  });

  describe('detectAvailableDriver', () => {
    it('should detect ioredis as available', () => {
      // When
      const driver = detectAvailableDriver();

      // Then
      // Since ioredis is installed in our test environment
      expect(driver).toBe('ioredis');
    });
  });

  describe('getRecommendedDriver', () => {
    it('should recommend ioredis', () => {
      // When
      const driver = getRecommendedDriver();

      // Then
      expect(driver).toBe('ioredis');
    });
  });

  describe('DriverFactory class', () => {
    let factory: DriverFactory;

    beforeEach(() => {
      factory = new DriverFactory();
    });

    describe('create', () => {
      it('should create driver with default type', () => {
        // When
        const driver = factory.create(singleConfig);

        // Then
        expect(driver).toBeInstanceOf(IoRedisAdapter);
      });

      it('should create driver with specified type', () => {
        // When
        const driver = factory.create(singleConfig, { type: 'node-redis' });

        // Then
        expect(driver).toBeInstanceOf(NodeRedisAdapter);
      });
    });

    describe('getSupportedTypes', () => {
      it('should return all supported driver types', () => {
        // When
        const types = factory.getSupportedTypes();

        // Then
        expect(types).toEqual(['ioredis', 'node-redis']);
      });
    });

    describe('isSupported', () => {
      it('should return true for ioredis', () => {
        // When
        const result = factory.isSupported('ioredis');

        // Then
        expect(result).toBe(true);
      });

      it('should return true for node-redis', () => {
        // When
        const result = factory.isSupported('node-redis');

        // Then
        expect(result).toBe(true);
      });

      it('should return false for unknown type', () => {
        // When
        const result = factory.isSupported('unknown');

        // Then
        expect(result).toBe(false);
      });
    });

    describe('getDefaultType', () => {
      it('should return default driver type', () => {
        // When
        const driverType = factory.getDefaultType();

        // Then
        expect(driverType).toBe('ioredis');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle config with all optional fields', () => {
      // Given
      const fullConfig: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
        password: 'secret',
        db: 5,
        keyPrefix: 'app:',
        connectTimeout: 5000,
        commandTimeout: 3000,
        keepAlive: 30000,
        enableAutoReconnect: true,
        maxRetriesPerRequest: 5,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        reconnectOnError: (err) => err.message.includes('READONLY'),
      };

      // When
      const driver = createDriver(fullConfig);

      // Then
      expect(driver).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle cluster config with options', () => {
      // Given
      const fullClusterConfig: ConnectionConfig = {
        type: 'cluster',
        nodes: [
          { host: 'localhost', port: 7000 },
          { host: 'localhost', port: 7001 },
          { host: 'localhost', port: 7002 },
        ],
        password: 'secret',
        clusterOptions: {
          enableReadyCheck: false,
          maxRedirections: 32,
          retryDelayOnClusterDown: 200,
          retryDelayOnFailover: 200,
          scaleReads: 'slave',
        },
      };

      // When
      const driver = createDriver(fullClusterConfig, { type: 'ioredis' });

      // Then
      expect(driver).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle sentinel config with options', () => {
      // Given
      const fullSentinelConfig: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [
          { host: 'localhost', port: 26379 },
          { host: 'localhost', port: 26380 },
        ],
        name: 'mymaster',
        password: 'secret',
        sentinelOptions: {
          sentinelPassword: 'sentinel-secret',
          sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
          enableTLSForSentinelMode: false,
        },
      };

      // When
      const driver = createDriver(fullSentinelConfig, { type: 'ioredis' });

      // Then
      expect(driver).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle TLS config', () => {
      // Given
      const tlsConfig: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6380,
        tls: {
          enabled: true,
          rejectUnauthorized: true,
          ca: 'ca-cert',
          cert: 'client-cert',
          key: 'client-key',
        },
      };

      // When
      const driver = createDriver(tlsConfig);

      // Then
      expect(driver).toBeInstanceOf(IoRedisAdapter);
    });
  });
});
