import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../../src/client/application/redis-client.manager';
import type { IRedisDriver } from '../../../src/interfaces';
import type { IClusterConnectionConfig } from '../../../src/types';

/**
 * Redis Cluster Integration Tests
 *
 * Prerequisites:
 * 1. Start Redis Cluster: npm run docker:cluster:up
 * 2. Run tests: npm run test:integration:cluster
 * 3. Stop cluster: npm run docker:cluster:down
 *
 * Cluster Configuration:
 * - 3 Masters: localhost:7001, localhost:7002, localhost:7003
 * - 3 Replicas: localhost:7004, localhost:7005, localhost:7006
 */
describe('Redis Cluster Integration', () => {
  let manager: RedisClientManager;
  let client: IRedisDriver;

  beforeAll(async () => {
    manager = new RedisClientManager();

    const clusterConfig: IClusterConnectionConfig = {
      type: 'cluster',
      nodes: [
        { host: '127.0.0.1', port: 7001 },
        { host: '127.0.0.1', port: 7002 },
        { host: '127.0.0.1', port: 7003 },
      ],
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > 10) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 2000);
      },
      clusterOptions: {
        natMap: {
          '172.28.0.11:7001': { host: '127.0.0.1', port: 7001 },
          '172.28.0.12:7002': { host: '127.0.0.1', port: 7002 },
          '172.28.0.13:7003': { host: '127.0.0.1', port: 7003 },
          '172.28.0.14:7004': { host: '127.0.0.1', port: 7004 },
          '172.28.0.15:7005': { host: '127.0.0.1', port: 7005 },
          '172.28.0.16:7006': { host: '127.0.0.1', port: 7006 },
        },
      },
    };

    client = await manager.createClient('cluster-test', clusterConfig);
    await client.connect();
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Basic Operations', () => {
    it('should set and get values across cluster', async () => {
      // Given
      const key = 'test:cluster:basic';
      const value = 'Hello Redis Cluster!';

      // When
      await client.set(key, value);
      const result = await client.get(key);

      // Then
      expect(result).toBe(value);

      // Cleanup
      await client.del(key);
    });

    it('should handle multiple keys across different slots', async () => {
      // Given - keys will hash to different slots
      const keys = ['test:cluster:key1', 'test:cluster:key2', 'test:cluster:key3'];

      // When
      for (const key of keys) {
        await client.set(key, `value-${key}`);
      }

      // Then
      for (const key of keys) {
        const value = await client.get(key);
        expect(value).toBe(`value-${key}`);
      }

      // Cleanup
      for (const key of keys) {
        await client.del(key);
      }
    });

    it('should support hash tags for same-slot keys', async () => {
      // Given - {user1} ensures all keys go to same slot
      const keys = ['{user1}:name', '{user1}:email', '{user1}:age'];

      // When
      await client.mset({
        [keys[0]]: 'John',
        [keys[1]]: 'john@example.com',
        [keys[2]]: '30',
      });

      // Then
      const values = await client.mget(...keys);
      expect(values).toEqual(['John', 'john@example.com', '30']);

      // Cleanup
      await client.del(...keys);
    });
  });

  describe('Data Structure Operations', () => {
    it('should work with hashes', async () => {
      // Given
      const key = 'test:cluster:hash';

      // When
      await client.hset(key, 'field1', 'value1');
      await client.hset(key, 'field2', 'value2');

      // Then
      const value1 = await client.hget(key, 'field1');
      const value2 = await client.hget(key, 'field2');
      expect(value1).toBe('value1');
      expect(value2).toBe('value2');

      const all = await client.hgetall(key);
      expect(all).toEqual({ field1: 'value1', field2: 'value2' });

      // Cleanup
      await client.del(key);
    });

    it('should work with lists', async () => {
      // Given
      const key = 'test:cluster:list';

      // When
      await client.lpush(key, 'item1', 'item2', 'item3');

      // Then
      const length = await client.llen(key);
      expect(length).toBe(3);

      const items = await client.lrange(key, 0, -1);
      expect(items).toEqual(['item3', 'item2', 'item1']);

      // Cleanup
      await client.del(key);
    });

    it('should work with sets', async () => {
      // Given
      const key = 'test:cluster:set';

      // When
      await client.sadd(key, 'member1', 'member2', 'member3');

      // Then
      const count = await client.scard(key);
      expect(count).toBe(3);

      const isMember = await client.sismember(key, 'member2');
      expect(isMember).toBe(1);

      // Cleanup
      await client.del(key);
    });

    it('should work with sorted sets', async () => {
      // Given
      const key = 'test:cluster:zset';

      // When
      await client.zadd(key, 1, 'member1');
      await client.zadd(key, 2, 'member2');
      await client.zadd(key, 3, 'member3');

      // Then
      const count = await client.zcard(key);
      expect(count).toBe(3);

      const range = await client.zrange(key, 0, -1);
      expect(range).toEqual(['member1', 'member2', 'member3']);

      // Cleanup
      await client.del(key);
    });
  });

  describe('Expiration and TTL', () => {
    it('should set expiration on keys', async () => {
      // Given
      const key = 'test:cluster:ttl';
      const value = 'temporary';

      // When
      await client.set(key, value);
      await client.expire(key, 10); // 10 seconds

      // Then
      const ttl = await client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);

      // Cleanup
      await client.del(key);
    });

    it('should support SETEX command', async () => {
      // Given
      const key = 'test:cluster:setex';
      const value = 'expires-soon';

      // When
      await client.set(key, value, { ex: 5 }); // 5 seconds

      // Then
      const storedValue = await client.get(key);
      expect(storedValue).toBe(value);

      const ttl = await client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5);

      // Cleanup
      await client.del(key);
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipeline commands', async () => {
      // Given
      const keyPrefix = '{pipeline}:key'; // Same slot
      const keys = Array.from({ length: 10 }, (_, i) => `${keyPrefix}${i}`);

      // When
      const pipeline = client.pipeline();
      keys.forEach((key, i) => {
        pipeline.set(key, `value${i}`);
      });
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(10);
      results.forEach((result: [Error | null, unknown]) => {
        expect(result[0]).toBeNull(); // No error
        expect(result[1]).toBe('OK');
      });

      // Verify values
      for (let i = 0; i < keys.length; i++) {
        const value = await client.get(keys[i]);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      await client.del(...keys);
    });
  });

  describe('Cluster-Specific Operations', () => {
    it('should retrieve cluster info', async () => {
      // When
      const info = await client.cluster('INFO');

      // Then
      expect(info).toContain('cluster_state:ok');
      expect(info).toContain('cluster_slots_assigned:16384');
    });

    it('should retrieve cluster nodes', async () => {
      // When
      const nodes = await client.cluster('NODES');

      // Then
      expect(nodes).toContain('master');
      expect(nodes).toContain('slave');
      // Should have 6 nodes (3 masters + 3 replicas)
      const nodeLines = nodes.trim().split('\n');
      expect(nodeLines.length).toBe(6);
    });

    it('should handle MOVED redirections transparently', async () => {
      // Given
      const key = 'test:cluster:moved';

      // When - ioredis handles MOVED automatically
      await client.set(key, 'value');
      const result = await client.get(key);

      // Then
      expect(result).toBe('value');

      // Cleanup
      await client.del(key);
    });
  });

  describe('Health Check', () => {
    it('should perform health check on cluster', async () => {
      // When
      const health = await manager.healthCheck('cluster-test');

      // Then
      expect(health).toBeDefined();
      expect(health.healthy).toBe(true);
      expect(health.status).toBeDefined();
    });

    it('should get cluster stats', async () => {
      // When
      const stats = manager.getStats();

      // Then
      expect(stats).toBeDefined();
      expect(stats.totalClients).toBe(1);
      expect(stats.clients['cluster-test']).toBeDefined();
      expect(stats.clients['cluster-test'].status).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent keys', async () => {
      // When
      const result = await client.get('test:cluster:nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should handle type mismatches gracefully', async () => {
      // Given
      const key = 'test:cluster:string';
      await client.set(key, 'string-value');

      // When/Then - trying to use list command on string
      await expect(client.lpush(key, 'item')).rejects.toThrow();

      // Cleanup
      await client.del(key);
    });
  });
});
