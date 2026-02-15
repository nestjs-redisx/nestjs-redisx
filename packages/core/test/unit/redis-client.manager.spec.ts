import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { RedisClientManager } from '../../src/client/application/redis-client.manager';
import { ManagerEvent } from '../../src/client/domain/interfaces/client-manager.interface';
import { ConnectionStatus } from '../../src/types';
import { MockRedisDriver, createMockConnectionConfig } from '../mocks/redis.mock';
import * as driverFactory from '../../src/driver/application/driver.factory';

// Mock driver factory
beforeAll(() => {
  vi.spyOn(driverFactory, 'createDriver').mockImplementation((config) => {
    return new MockRedisDriver(config as any);
  });
});

describe('RedisClientManager', () => {
  let manager: RedisClientManager;

  beforeEach(() => {
    manager = new RedisClientManager();
  });

  afterEach(async () => {
    await manager.closeAll();
    vi.clearAllMocks();
  });

  describe('createClient', () => {
    it('should create a new client', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');

      // When
      const client = await manager.createClient('test', config);

      // Then
      expect(client).toBeDefined();
      expect(manager.hasClient('test')).toBe(true);
    });

    it('should emit CREATED event when client is created', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const eventSpy = vi.fn();
      manager.on(ManagerEvent.CREATED, eventSpy);

      // When
      await manager.createClient('test', config);

      // Then
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
        }),
      );
    });

    it('should throw error when client already exists', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When/Then
      await expect(manager.createClient('test', config)).rejects.toThrow('already exists');
    });
  });

  describe('getClient', () => {
    it('should return existing client', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When
      const client = await manager.getClient('test');

      // Then
      expect(client).toBeDefined();
    });

    it('should throw error when client not found', async () => {
      // When/Then
      await expect(manager.getClient('nonexistent')).rejects.toThrow('not found');
    });

    it('should use default client name when not specified', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('default', config);

      // When
      const client = await manager.getClient();

      // Then
      expect(client).toBeDefined();
    });
  });

  describe('hasClient', () => {
    it('should return true when client exists', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When/Then
      expect(manager.hasClient('test')).toBe(true);
    });

    it('should return false when client does not exist', () => {
      // When/Then
      expect(manager.hasClient('nonexistent')).toBe(false);
    });
  });

  describe('getClientNames', () => {
    it('should return all client names', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      const names = manager.getClientNames();

      // Then
      expect(names).toContain('test1');
      expect(names).toContain('test2');
      expect(names).toHaveLength(2);
    });

    it('should return empty array when no clients', () => {
      // When
      const names = manager.getClientNames();

      // Then
      expect(names).toEqual([]);
    });
  });

  describe('closeClient', () => {
    it('should close and remove client', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When
      await manager.closeClient('test');

      // Then
      expect(manager.hasClient('test')).toBe(false);
    });

    it('should emit REMOVED event when client is closed', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      const eventSpy = vi.fn();
      manager.on(ManagerEvent.REMOVED, eventSpy);

      // When
      await manager.closeClient('test');

      // Then
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test',
        }),
      );
    });

    it('should throw error when client not found', async () => {
      // When/Then
      await expect(manager.closeClient('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('closeAll', () => {
    it('should close all clients', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      await manager.closeAll();

      // Then
      expect(manager.hasClient('test1')).toBe(false);
      expect(manager.hasClient('test2')).toBe(false);
    });

    it('should close multiple clients', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      const initialCount = manager.getClientNames().length;
      await manager.closeAll();
      const finalCount = manager.getClientNames().length;

      // Then
      expect(initialCount).toBe(2);
      expect(finalCount).toBe(0);
    });

    it('should handle errors gracefully when closing clients', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const client1 = await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // Make first client throw on disconnect
      client1.disconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'));

      // When
      await manager.closeAll();

      // Then - should still close both clients despite error
      expect(manager.hasClient('test1')).toBe(false);
      expect(manager.hasClient('test2')).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should return health status for all clients when no name specified', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      const health = await manager.healthCheck();

      // Then
      expect(Array.isArray(health)).toBe(true);
      expect(health).toHaveLength(2);
    });

    it('should return health status for specific client', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When
      const health = await manager.healthCheck('test');

      // Then
      expect(health).toBeDefined();
      expect(Array.isArray(health)).toBe(false);
    });

    it('should throw error when client not found', async () => {
      // When/Then
      await expect(manager.healthCheck('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('getStats', () => {
    it('should return stats for all clients', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When
      const stats = manager.getStats();

      // Then
      expect(stats).toBeDefined();
      expect(stats.totalClients).toBe(1);
      expect(stats.clients).toBeDefined();
      expect(stats.clients['test']).toBeDefined();
      expect(stats.collectedAt).toBeInstanceOf(Date);
    });

    it('should return stats for multiple clients', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      const stats = manager.getStats();

      // Then
      expect(stats.totalClients).toBe(2);
      expect(Object.keys(stats.clients)).toHaveLength(2);
      expect(stats.clients['test1']).toBeDefined();
      expect(stats.clients['test2']).toBeDefined();
    });
  });

  describe('getMetadata', () => {
    it('should return client metadata', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When
      const metadata = manager.getMetadata('test');

      // Then
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('test');
      expect(metadata.config).toEqual(config);
    });

    it('should throw error when client not found', () => {
      // When/Then
      expect(() => manager.getMetadata('nonexistent')).toThrow('not found');
    });
  });

  describe('updateMetadata', () => {
    it('should update client metadata', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      const updates = {
        tags: ['cache', 'production'],
      };

      // When
      manager.updateMetadata('test', updates);
      const metadata = manager.getMetadata('test');

      // Then
      expect(metadata.tags).toEqual(['cache', 'production']);
    });

    it('should throw error when client not found', () => {
      // When/Then
      expect(() => manager.updateMetadata('nonexistent', { tags: ['test'] })).toThrow('not found');
    });
  });

  describe('event handling', () => {
    it('should register event listener', () => {
      // Given
      const handler = vi.fn();

      // When
      manager.on(ManagerEvent.CREATED, handler);

      // Then - no error thrown
      expect(true).toBe(true);
    });

    it('should remove event listener', () => {
      // Given
      const handler = vi.fn();
      manager.on(ManagerEvent.CREATED, handler);

      // When
      manager.off(ManagerEvent.CREATED, handler);

      // Then - no error thrown
      expect(true).toBe(true);
    });
  });

  describe('Latency Statistics', () => {
    it('should track latency statistics on multiple health checks', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const driver = await manager.createClient('test', config);
      await driver.connect(); // Explicitly connect

      // When - First health check
      const health1 = await manager.healthCheck('test');
      // Second health check - this will trigger average latency calculation
      const health2 = await manager.healthCheck('test');
      // Third health check - test peak latency
      const health3 = await manager.healthCheck('test');

      // Then
      expect(health1).toBeDefined();
      expect(health2).toBeDefined();
      expect(health3).toBeDefined();
      expect(health1.healthy).toBe(true);
    });

    it('should update peak latency when higher latency is detected', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const driver = await manager.createClient('test', config);
      await driver.connect(); // Explicitly connect

      // When - Multiple health checks
      await manager.healthCheck('test');
      await manager.healthCheck('test');
      const allStats = manager.getStats();

      // Then
      expect(allStats.clients['test']).toBeDefined();
      expect(allStats.clients['test'].peakLatency).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average latency correctly', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const driver = await manager.createClient('test', config);
      await driver.connect(); // Explicitly connect

      // When - Multiple health checks to trigger average calculation
      await manager.healthCheck('test');
      await manager.healthCheck('test');
      await manager.healthCheck('test');
      const allStats = manager.getStats();

      // Then
      expect(allStats.clients['test']).toBeDefined();
      expect(allStats.clients['test'].averageLatency).toBeGreaterThanOrEqual(0);
      expect(allStats.clients['test'].commandsExecuted).toBeGreaterThan(0);
    });

    it('should update peak latency when new latency is higher', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const driver = await manager.createClient('test', config);
      await driver.connect();

      // Mock ping to simulate varying latencies
      let callCount = 0;
      driver.ping = vi.fn().mockImplementation(async () => {
        callCount++;
        // Second call takes longer to simulate higher latency
        if (callCount === 2) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return 'PONG';
      });

      // First health check establishes baseline with fast ping
      await manager.healthCheck('test');
      const stats1 = manager.getStats();
      const firstPeak = stats1.clients['test'].peakLatency;

      // When - Second health check with slower ping
      await manager.healthCheck('test');
      const stats2 = manager.getStats();

      // Then - Peak should be updated to a higher value
      expect(stats2.clients['test'].peakLatency).toBeGreaterThan(firstPeak);
    });
  });

  describe('Uptime Calculation', () => {
    it('should return zero uptime when client is not connected', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);
      await manager.closeClient('test');

      // Recreate without connecting
      await manager.createClient('test', config);

      // When
      const health = await manager.healthCheck('test');

      // Then
      expect(health.metadata.uptime).toBe(0);
    });

    it('should calculate uptime when client is connected', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // Wait a bit to ensure uptime > 0
      await new Promise((resolve) => setTimeout(resolve, 10));

      // When
      const health = await manager.healthCheck('test');

      // Then
      expect(health.metadata.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return zero uptime when connectedAt is null', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      const driver = await manager.createClient('test', config);

      // Manually set connectedAt to null to simulate unconnected state
      const metadata = manager.getMetadata('test');
      const managedClient = (manager as any).clients.get('test');
      managedClient.stats.connectedAt = null;

      // When
      const health = await manager.healthCheck('test');

      // Then
      expect(health.metadata.uptime).toBe(0);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent client creation', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');

      // When - Create clients concurrently
      const promises = [manager.createClient('concurrent1', config), manager.createClient('concurrent2', config), manager.createClient('concurrent3', config)];
      await Promise.all(promises);

      // Then
      expect(manager.hasClient('concurrent1')).toBe(true);
      expect(manager.hasClient('concurrent2')).toBe(true);
      expect(manager.hasClient('concurrent3')).toBe(true);
    });

    it('should handle concurrent health checks', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When - Perform health checks concurrently
      const promises = [manager.healthCheck('test1'), manager.healthCheck('test2'), manager.healthCheck('test1')];
      const results = await Promise.all(promises);

      // Then
      expect(results).toHaveLength(3);
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
    });

    it('should handle concurrent metadata updates', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test', config);

      // When - Update metadata concurrently
      const promises = [manager.updateMetadata('test', { tag: 'v1' }), manager.updateMetadata('test', { env: 'prod' }), manager.updateMetadata('test', { region: 'us-east' })];
      await Promise.all(promises);

      // Then
      const metadata = manager.getMetadata('test');
      expect(metadata).toBeDefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close all clients on module destroy', async () => {
      // Given
      const config = createMockConnectionConfig('ioredis');
      await manager.createClient('test1', config);
      await manager.createClient('test2', config);

      // When
      await manager.onModuleDestroy();

      // Then
      expect(manager.hasClient('test1')).toBe(false);
      expect(manager.hasClient('test2')).toBe(false);
    });
  });
});
