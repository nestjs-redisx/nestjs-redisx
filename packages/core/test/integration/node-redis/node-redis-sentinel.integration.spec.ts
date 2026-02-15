import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDriver } from '../../../src/driver/application/driver.factory';
import { ConnectionConfig } from '../../../src/types';
import { DriverEvent, IRedisDriver } from '../../../src/interfaces';

/**
 * Node-Redis Sentinel Integration Tests
 *
 * Tests the node-redis adapter with Redis Sentinel mode.
 *
 * IMPORTANT LIMITATION:
 * Node-redis v4+ does NOT support natMap like ioredis.
 * This means that when running with Docker (bridge network), the sentinel
 * returns internal Docker IPs that aren't accessible from the host.
 *
 * This test works when:
 * - Running on Linux with host network mode
 * - Redis Sentinel is running natively (not in Docker)
 * - Using a network setup where sentinel-reported IPs are directly accessible
 *
 * For Docker on macOS/Windows, use the ioredis driver with natMap support instead.
 *
 * Prerequisites:
 * 1. Start Redis Sentinel (native or host network): see docker-compose.sentinel.yml
 * 2. Ensure sentinel-reported master IP is accessible from test runner
 * 3. Run tests: npx vitest run test/integration/node-redis/node-redis-sentinel.integration.spec.ts
 *
 * Sentinel Configuration:
 * - Master: localhost:6379
 * - Replicas: localhost:6380, localhost:6381
 * - Sentinels: localhost:26379, localhost:26380, localhost:26381
 * - Master name: mymaster
 */
describe.skip('Node-Redis Sentinel Integration', () => {
  // SKIPPED: node-redis doesn't support natMap - use ioredis for Docker sentinel setups
  let driver: IRedisDriver;

  beforeAll(async () => {
    const config: ConnectionConfig = {
      type: 'sentinel',
      name: 'mymaster',
      sentinels: [
        { host: 'localhost', port: 26379 },
        { host: 'localhost', port: 26380 },
        { host: 'localhost', port: 26381 },
      ],
      connectTimeout: 10000,
    };

    driver = createDriver(config, { type: 'node-redis' });

    // Add error handler to prevent unhandled errors
    driver.on(DriverEvent.ERROR, (error: Error) => {
      console.error('Sentinel driver error:', error.message);
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
      const key = 'test:node-redis:sentinel:string';
      const value = 'Hello Node-Redis Sentinel!';

      // When
      await driver.set(key, value);
      const result = await driver.get(key);

      // Then
      expect(result).toBe(value);

      // Cleanup
      await driver.del(key);
    });

    it('should handle multiple operations', async () => {
      // Given
      const operations = [
        { key: 'test:node-redis:sentinel:op1', value: 'value1' },
        { key: 'test:node-redis:sentinel:op2', value: 'value2' },
        { key: 'test:node-redis:sentinel:op3', value: 'value3' },
      ];

      // When
      for (const op of operations) {
        await driver.set(op.key, op.value);
      }

      // Then
      for (const op of operations) {
        const value = await driver.get(op.key);
        expect(value).toBe(op.value);
      }

      // Cleanup
      for (const op of operations) {
        await driver.del(op.key);
      }
    });

    it('should return null for non-existent keys', async () => {
      // When
      const result = await driver.get('test:node-redis:sentinel:nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      // Given
      const key = 'test:node-redis:sentinel:delete';
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
      const key = 'test:node-redis:sentinel:counter';
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

    it('should support atomic decrement', async () => {
      // Given
      const key = 'test:node-redis:sentinel:decr';
      await driver.set(key, '10');

      // When
      const result1 = await driver.decr(key);
      const result2 = await driver.decrby(key, 3);

      // Then
      expect(result1).toBe(9);
      expect(result2).toBe(6);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Set Options', () => {
    it('should set with expiration (EX)', async () => {
      // Given
      const key = 'test:node-redis:sentinel:ex';

      // When
      await driver.set(key, 'expires', { ex: 30 });

      // Then
      const value = await driver.get(key);
      expect(value).toBe('expires');

      const ttl = await driver.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      // Cleanup
      await driver.del(key);
    });

    it('should set with NX (only if not exists)', async () => {
      // Given
      const key = 'test:node-redis:sentinel:nx';
      await driver.set(key, 'original');

      // When
      const result = await driver.set(key, 'updated', { nx: true });

      // Then
      expect(result).toBeNull();

      const value = await driver.get(key);
      expect(value).toBe('original');

      // Cleanup
      await driver.del(key);
    });

    it('should set with XX (only if exists)', async () => {
      // Given
      const key = 'test:node-redis:sentinel:xx';

      // When - try to set non-existent key
      const result1 = await driver.set(key, 'value', { xx: true });

      // Then
      expect(result1).toBeNull();

      // When - set existing key
      await driver.set(key, 'original');
      const result2 = await driver.set(key, 'updated', { xx: true });

      // Then
      expect(result2).toBe('OK');

      const value = await driver.get(key);
      expect(value).toBe('updated');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash fields', async () => {
      // Given
      const key = 'test:node-redis:sentinel:hash';

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
      const key = 'test:node-redis:sentinel:hash:all';
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
      const key = 'test:node-redis:sentinel:list';

      // When
      await driver.rpush(key, 'first', 'second', 'third');

      // Then
      const length = await driver.llen(key);
      expect(length).toBe(3);

      const items = await driver.lrange(key, 0, -1);
      expect(items).toEqual(['first', 'second', 'third']);

      const popped = await driver.lpop(key);
      expect(popped).toBe('first');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Set Operations', () => {
    it('should add and retrieve set members', async () => {
      // Given
      const key = 'test:node-redis:sentinel:set';

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
      const key = 'test:node-redis:sentinel:zset';

      // When
      await driver.zadd(key, 100, 'user1');
      await driver.zadd(key, 200, 'user2');
      await driver.zadd(key, 150, 'user3');

      // Then
      const count = await driver.zcard(key);
      expect(count).toBe(3);

      const range = await driver.zrange(key, 0, -1);
      expect(range).toEqual(['user1', 'user3', 'user2']);

      const score = await driver.zscore(key, 'user2');
      expect(score).toBe('200');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipelined commands', async () => {
      // Given
      const keys = ['test:node-redis:sentinel:pipe:1', 'test:node-redis:sentinel:pipe:2', 'test:node-redis:sentinel:pipe:3'];

      // When
      const pipeline = driver.pipeline();
      keys.forEach((key, i) => {
        pipeline.set(key, `value${i}`);
      });
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(3);
      results.forEach((result: [Error | null, unknown]) => {
        expect(result[0]).toBeNull();
        expect(result[1]).toBe('OK');
      });

      // Verify
      for (let i = 0; i < keys.length; i++) {
        const value = await driver.get(keys[i]);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      await driver.del(...keys);
    });

    it('should handle mixed operations in pipeline', async () => {
      // Given
      const baseKey = 'test:node-redis:sentinel:mixed';

      // When
      const pipeline = driver.pipeline();
      pipeline.set(baseKey, 'initial');
      pipeline.incr(`${baseKey}:counter`);
      pipeline.lpush(`${baseKey}:list`, 'item1', 'item2');
      pipeline.sadd(`${baseKey}:set`, 'member1');
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(4);
      expect(results[0][1]).toBe('OK');
      expect(results[1][1]).toBe(1);
      expect(results[2][1]).toBe(2);
      expect(results[3][1]).toBe(1);

      // Cleanup
      await driver.del(baseKey, `${baseKey}:counter`, `${baseKey}:list`, `${baseKey}:set`);
    });
  });

  describe('Multi/Exec Operations', () => {
    it('should execute transactions', async () => {
      // Given
      const key = 'test:node-redis:sentinel:multi';

      // When
      const multi = driver.multi();
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

      const finalValue = await driver.get(key);
      expect(finalValue).toBe('3');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Expiration Operations', () => {
    it('should set and check TTL', async () => {
      // Given
      const key = 'test:node-redis:sentinel:ttl';
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

    it('should persist keys', async () => {
      // Given
      const key = 'test:node-redis:sentinel:persist';
      await driver.set(key, 'value', { ex: 100 });

      // When
      await driver.persist(key);
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBe(-1); // -1 means no expiration

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

  describe('Connection Resilience', () => {
    it('should maintain connection through sentinel', async () => {
      // Given
      const keyBase = 'test:node-redis:sentinel:resilience';

      // When - multiple sequential operations
      for (let i = 0; i < 10; i++) {
        await driver.set(`${keyBase}:${i}`, `value${i}`);
      }

      // Then - all operations should succeed
      for (let i = 0; i < 10; i++) {
        const value = await driver.get(`${keyBase}:${i}`);
        expect(value).toBe(`value${i}`);
      }

      // Cleanup
      for (let i = 0; i < 10; i++) {
        await driver.del(`${keyBase}:${i}`);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operations', async () => {
      // Given
      const key = 'test:node-redis:sentinel:error';
      await driver.set(key, 'string-value');

      // When/Then - LPUSH on string should throw
      await expect(driver.lpush(key, 'item')).rejects.toThrow();

      // Cleanup
      await driver.del(key);
    });
  });
});
