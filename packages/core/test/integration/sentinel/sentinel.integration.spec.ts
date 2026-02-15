import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../../src/client/application/redis-client.manager';
import type { IRedisDriver } from '../../../src/interfaces';
import type { ISentinelConnectionConfig } from '../../../src/types';

/**
 * Redis Sentinel Integration Tests
 *
 * Prerequisites:
 * 1. Start Redis Sentinel: npm run docker:sentinel:up
 * 2. Run tests: npm run test:integration:sentinel
 * 3. Stop sentinel: npm run docker:sentinel:down
 *
 * Sentinel Configuration:
 * - Master: localhost:6379
 * - Replicas: localhost:6380, localhost:6381
 * - Sentinels: localhost:26379, localhost:26380, localhost:26381
 * - Master name: mymaster
 */
describe('Redis Sentinel Integration', () => {
  let manager: RedisClientManager;
  let client: IRedisDriver;

  beforeAll(async () => {
    manager = new RedisClientManager();

    const sentinelConfig: ISentinelConnectionConfig = {
      type: 'sentinel',
      name: 'mymaster',
      sentinels: [
        { host: 'localhost', port: 26379 },
        { host: 'localhost', port: 26380 },
        { host: 'localhost', port: 26381 },
      ],
      connectTimeout: 10000,
      sentinelOptions: {
        sentinelRetryStrategy: (times: number) => {
          if (times > 10) {
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        // natMap for Docker bridge network - maps internal Docker IPs to localhost
        // Note: Docker network subnet 172.23.0.0/16 is used by docker-compose.sentinel.yml
        natMap: {
          '172.23.0.2:6379': { host: 'localhost', port: 6379 },
          '172.23.0.3:6380': { host: 'localhost', port: 6380 },
          '172.23.0.4:6381': { host: 'localhost', port: 6381 },
        },
      },
    };

    client = await manager.createClient('sentinel-test', sentinelConfig);
    await client.connect();
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Basic Operations', () => {
    it('should set and get values through sentinel', async () => {
      // Given
      const key = 'test:sentinel:basic';
      const value = 'Hello Redis Sentinel!';

      // When
      await client.set(key, value);
      const result = await client.get(key);

      // Then
      expect(result).toBe(value);

      // Cleanup
      await client.del(key);
    });

    it('should handle multiple operations', async () => {
      // Given
      const operations = [
        { key: 'test:sentinel:op1', value: 'value1' },
        { key: 'test:sentinel:op2', value: 'value2' },
        { key: 'test:sentinel:op3', value: 'value3' },
      ];

      // When
      for (const op of operations) {
        await client.set(op.key, op.value);
      }

      // Then
      for (const op of operations) {
        const value = await client.get(op.key);
        expect(value).toBe(op.value);
      }

      // Cleanup
      for (const op of operations) {
        await client.del(op.key);
      }
    });

    it('should support atomic operations', async () => {
      // Given
      const key = 'test:sentinel:counter';

      // When
      await client.set(key, '0');
      const result1 = await client.incr(key);
      const result2 = await client.incr(key);
      const result3 = await client.incrby(key, 5);

      // Then
      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(result3).toBe(7);

      // Cleanup
      await client.del(key);
    });
  });

  describe('Data Structure Operations', () => {
    it('should work with hashes', async () => {
      // Given
      const key = 'test:sentinel:hash';

      // When
      await client.hmset(key, {
        name: 'John Doe',
        email: 'john@example.com',
        age: '30',
      });

      // Then
      const name = await client.hget(key, 'name');
      const email = await client.hget(key, 'email');
      expect(name).toBe('John Doe');
      expect(email).toBe('john@example.com');

      const all = await client.hgetall(key);
      expect(all.name).toBe('John Doe');
      expect(all.age).toBe('30');

      // Cleanup
      await client.del(key);
    });

    it('should work with lists', async () => {
      // Given
      const key = 'test:sentinel:list';

      // When
      await client.rpush(key, 'first', 'second', 'third');

      // Then
      const length = await client.llen(key);
      expect(length).toBe(3);

      const items = await client.lrange(key, 0, -1);
      expect(items).toEqual(['first', 'second', 'third']);

      const popped = await client.lpop(key);
      expect(popped).toBe('first');

      // Cleanup
      await client.del(key);
    });

    it('should work with sets', async () => {
      // Given
      const key = 'test:sentinel:set';

      // When
      await client.sadd(key, 'apple', 'banana', 'cherry');

      // Then
      const members = await client.smembers(key);
      expect(members).toHaveLength(3);
      expect(members).toContain('apple');
      expect(members).toContain('banana');
      expect(members).toContain('cherry');

      // Cleanup
      await client.del(key);
    });

    it('should work with sorted sets', async () => {
      // Given
      const key = 'test:sentinel:zset';

      // When
      await client.zadd(key, 100, 'user1', 200, 'user2', 150, 'user3');

      // Then
      const count = await client.zcard(key);
      expect(count).toBe(3);

      const range = await client.zrange(key, 0, -1);
      expect(range).toEqual(['user1', 'user3', 'user2']);

      const score = await client.zscore(key, 'user2');
      expect(score).toBe('200');

      // Cleanup
      await client.del(key);
    });
  });

  describe('Expiration and Persistence', () => {
    it('should set and check TTL', async () => {
      // Given
      const key = 'test:sentinel:ttl';

      // When
      await client.set(key, 'temporary', { ex: 30 });

      // Then
      const ttl = await client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      // Cleanup
      await client.del(key);
    });

    it('should persist keys', async () => {
      // Given
      const key = 'test:sentinel:persist';

      // When
      await client.set(key, 'value', { ex: 100 });
      await client.persist(key);

      // Then
      const ttl = await client.ttl(key);
      expect(ttl).toBe(-1); // -1 means no expiration

      // Cleanup
      await client.del(key);
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipelined commands', async () => {
      // Given
      const keys = Array.from({ length: 5 }, (_, i) => `test:sentinel:pipe:${i}`);

      // When
      const pipeline = client.pipeline();
      keys.forEach((key, i) => {
        pipeline.set(key, `value${i}`);
      });
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(5);
      results.forEach((result: [Error | null, unknown]) => {
        expect(result[0]).toBeNull();
        expect(result[1]).toBe('OK');
      });

      // Verify
      for (let i = 0; i < keys.length; i++) {
        const value = await client.get(keys[i]);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      await client.del(...keys);
    });

    it('should handle mixed operations in pipeline', async () => {
      // Given
      const key = 'test:sentinel:mixed';

      // When
      const pipeline = client.pipeline();
      pipeline.set(key, 'initial');
      pipeline.incr(`${key}:counter`);
      pipeline.lpush(`${key}:list`, 'item1', 'item2');
      pipeline.sadd(`${key}:set`, 'member1');
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(4);
      expect(results[0][1]).toBe('OK');
      expect(results[1][1]).toBe(1);
      expect(results[2][1]).toBe(2);
      expect(results[3][1]).toBe(1);

      // Cleanup
      await client.del(key, `${key}:counter`, `${key}:list`, `${key}:set`);
    });
  });

  describe('Transaction Operations', () => {
    it('should execute multi/exec transactions', async () => {
      // Given
      const key = 'test:sentinel:transaction';

      // When
      const multi = client.multi();
      multi.set(key, '0');
      multi.incr(key);
      multi.incr(key);
      multi.incr(key);
      const results = await multi.exec();

      // Then
      expect(results).toHaveLength(4);
      expect(results[0][1]).toBe('OK');
      expect(results[1][1]).toBe(1);
      expect(results[2][1]).toBe(2);
      expect(results[3][1]).toBe(3);

      const finalValue = await client.get(key);
      expect(finalValue).toBe('3');

      // Cleanup
      await client.del(key);
    });
  });

  describe('Sentinel-Specific Operations', () => {
    it('should connect to master via sentinel', async () => {
      // Given - client is already connected via sentinel
      const key = 'test:sentinel:connection';

      // When - verify we can write to master
      await client.set(key, 'connected-via-sentinel');
      const result = await client.get(key);

      // Then
      expect(result).toBe('connected-via-sentinel');

      // Cleanup
      await client.del(key);
    });
  });

  describe('Health Check', () => {
    it('should perform health check on sentinel client', async () => {
      // When
      const health = await manager.healthCheck('sentinel-test');

      // Then
      expect(health).toBeDefined();
      expect(health.healthy).toBe(true);
      expect(health.status).toBeDefined();
    });

    it('should get sentinel client stats', async () => {
      // When
      const stats = manager.getStats();

      // Then
      expect(stats).toBeDefined();
      expect(stats.totalClients).toBe(1);
      expect(stats.clients['sentinel-test']).toBeDefined();
      expect(stats.clients['sentinel-test'].status).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent keys', async () => {
      // When
      const result = await client.get('test:sentinel:nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should handle invalid operations', async () => {
      // Given
      const key = 'test:sentinel:string';
      await client.set(key, 'string-value');

      // When/Then
      await expect(client.lpush(key, 'item')).rejects.toThrow();

      // Cleanup
      await client.del(key);
    });
  });

  describe('Connection Resilience', () => {
    it('should maintain connection through sentinel', async () => {
      // Given
      const key = 'test:sentinel:resilience';

      // When - multiple sequential operations
      for (let i = 0; i < 10; i++) {
        await client.set(`${key}:${i}`, `value${i}`);
      }

      // Then - all operations should succeed
      for (let i = 0; i < 10; i++) {
        const value = await client.get(`${key}:${i}`);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      const keys = Array.from({ length: 10 }, (_, i) => `${key}:${i}`);
      await client.del(...keys);
    });
  });
});
