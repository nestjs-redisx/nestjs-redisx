import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDriver } from '../../../src/driver/application/driver.factory';
import { ConnectionConfig } from '../../../src/types';
import { DriverEvent, IRedisDriver } from '../../../src/interfaces';

/**
 * Node-Redis Cluster Integration Tests
 *
 * Tests the node-redis adapter with Redis Cluster mode.
 *
 * Prerequisites:
 * 1. Start Redis Cluster: docker compose -f docker-compose.cluster.yml up -d
 * 2. Wait for cluster init: sleep 15
 * 3. Run tests: npx vitest run test/integration/node-redis/node-redis-cluster.integration.spec.ts
 * 4. Stop cluster: docker compose -f docker-compose.cluster.yml down
 *
 * Cluster Configuration (docker-compose.cluster.yml):
 * - 6 nodes: 3 masters + 3 replicas
 * - Ports: 7001-7006
 * - Docker network IPs: 172.28.0.11-16
 *
 * Note: Uses natMap (nodeAddressMap) to map Docker internal IPs to localhost
 */
describe('Node-Redis Cluster Integration', () => {
  let driver: IRedisDriver;

  beforeAll(async () => {
    const config: ConnectionConfig = {
      type: 'cluster',
      nodes: [
        { host: 'localhost', port: 7001 },
        { host: 'localhost', port: 7002 },
        { host: 'localhost', port: 7003 },
      ],
      connectTimeout: 10000,
      clusterOptions: {
        maxRedirections: 16,
        // NAT mapping for Docker bridge network
        // Maps internal Docker IPs to localhost ports
        natMap: {
          '172.28.0.11:7001': { host: 'localhost', port: 7001 },
          '172.28.0.12:7002': { host: 'localhost', port: 7002 },
          '172.28.0.13:7003': { host: 'localhost', port: 7003 },
          '172.28.0.14:7004': { host: 'localhost', port: 7004 },
          '172.28.0.15:7005': { host: 'localhost', port: 7005 },
          '172.28.0.16:7006': { host: 'localhost', port: 7006 },
        },
      },
    };

    driver = createDriver(config, { type: 'node-redis' });

    // Add error handler to prevent unhandled errors
    driver.on(DriverEvent.ERROR, (error: Error) => {
      console.error('Cluster driver error:', error.message);
    });

    await driver.connect();
  }, 30000);

  afterAll(async () => {
    if (driver && driver.isConnected()) {
      await driver.disconnect();
    }
  });

  describe('Basic Operations', () => {
    it('should set and get string values', async () => {
      // Given
      const key = 'test:node-redis:cluster:string';
      const value = 'Hello Node-Redis Cluster!';

      // When
      await driver.set(key, value);
      const result = await driver.get(key);

      // Then
      expect(result).toBe(value);

      // Cleanup
      await driver.del(key);
    });

    it('should handle multiple keys across slots', async () => {
      // Given - keys that hash to different slots
      const keys = [
        'test:cluster:key1', // Different slot
        'test:cluster:key2', // Different slot
        'test:cluster:key3', // Different slot
      ];

      // When
      for (let i = 0; i < keys.length; i++) {
        await driver.set(keys[i], `value${i}`);
      }

      // Then
      for (let i = 0; i < keys.length; i++) {
        const value = await driver.get(keys[i]);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      for (const key of keys) {
        await driver.del(key);
      }
    });

    it('should return null for non-existent keys', async () => {
      // When
      const result = await driver.get('test:node-redis:cluster:nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      // Given
      const key = 'test:node-redis:cluster:delete';
      await driver.set(key, 'to-delete');

      // When
      const deleted = await driver.del(key);

      // Then
      expect(deleted).toBe(1);

      const result = await driver.get(key);
      expect(result).toBeNull();
    });
  });

  describe('Atomic Operations', () => {
    it('should support atomic increment', async () => {
      // Given
      const key = 'test:node-redis:cluster:counter';
      await driver.set(key, '0');

      // When
      const result1 = await driver.incr(key);
      const result2 = await driver.incr(key);
      const result3 = await driver.incrby(key, 5);

      // Then
      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(result3).toBe(7);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash fields', async () => {
      // Given
      const key = 'test:node-redis:cluster:hash';

      // When
      await driver.hset(key, 'name', 'Alice');
      await driver.hset(key, 'age', '30');

      // Then
      const name = await driver.hget(key, 'name');
      const age = await driver.hget(key, 'age');

      expect(name).toBe('Alice');
      expect(age).toBe('30');

      // Cleanup
      await driver.del(key);
    });

    it('should get all hash fields', async () => {
      // Given
      const key = 'test:node-redis:cluster:hash:all';
      await driver.hset(key, 'field1', 'value1');
      await driver.hset(key, 'field2', 'value2');

      // When
      const all = await driver.hgetall(key);

      // Then
      expect(all).toEqual({ field1: 'value1', field2: 'value2' });

      // Cleanup
      await driver.del(key);
    });
  });

  describe('List Operations', () => {
    it('should push and pop from lists', async () => {
      // Given
      const key = 'test:node-redis:cluster:list';

      // When
      await driver.rpush(key, 'first', 'second', 'third');

      // Then
      const length = await driver.llen(key);
      expect(length).toBe(3);

      const items = await driver.lrange(key, 0, -1);
      expect(items).toEqual(['first', 'second', 'third']);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Set Operations', () => {
    it('should add and retrieve set members', async () => {
      // Given
      const key = 'test:node-redis:cluster:set';

      // When
      await driver.sadd(key, 'apple', 'banana', 'cherry');

      // Then
      const members = await driver.smembers(key);
      expect(members).toHaveLength(3);
      expect(members).toContain('apple');
      expect(members).toContain('banana');
      expect(members).toContain('cherry');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Sorted Set Operations', () => {
    it('should add and retrieve sorted set members', async () => {
      // Given
      const key = 'test:node-redis:cluster:zset';

      // When
      await driver.zadd(key, 100, 'user1');
      await driver.zadd(key, 200, 'user2');
      await driver.zadd(key, 150, 'user3');

      // Then
      const count = await driver.zcard(key);
      expect(count).toBe(3);

      const range = await driver.zrange(key, 0, -1);
      expect(range).toEqual(['user1', 'user3', 'user2']);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Expiration Operations', () => {
    it('should set and check TTL', async () => {
      // Given
      const key = 'test:node-redis:cluster:ttl';
      await driver.set(key, 'value');

      // When
      await driver.expire(key, 30);
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Connection Management', () => {
    it('should report connection status', () => {
      // When
      const isConnected = driver.isConnected();

      // Then
      expect(isConnected).toBe(true);
    });

    it('should ping server', async () => {
      // When
      const result = await driver.ping();

      // Then
      expect(result).toBe('PONG');
    });
  });

  describe('Cluster-Specific Operations', () => {
    it('should handle MOVED redirections transparently', async () => {
      // Given - keys that definitely hash to different slots
      const testKeys = Array.from({ length: 10 }, (_, i) => `test:cluster:slot:${i}`);

      // When - set values on keys across different slots
      for (let i = 0; i < testKeys.length; i++) {
        await driver.set(testKeys[i], `value${i}`);
      }

      // Then - should be able to read all values
      for (let i = 0; i < testKeys.length; i++) {
        const value = await driver.get(testKeys[i]);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      for (const key of testKeys) {
        await driver.del(key);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operations', async () => {
      // Given
      const key = 'test:node-redis:cluster:error';
      await driver.set(key, 'string-value');

      // When/Then - LPUSH on string should throw
      await expect(driver.lpush(key, 'item')).rejects.toThrow();

      // Cleanup
      await driver.del(key);
    });
  });
});
