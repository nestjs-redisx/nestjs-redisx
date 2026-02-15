import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDriver } from '../../../src/driver/application/driver.factory';
import type { IRedisDriver } from '../../../src/interfaces';
import type { ISingleConnectionConfig } from '../../../src/types';

/**
 * Node-Redis Driver Integration Tests
 *
 * Tests the node-redis adapter implementation.
 *
 * Prerequisites:
 * 1. Start standalone Redis: docker run -d -p 6379:6379 redis:7-alpine
 * 2. Run tests: npx vitest run test/integration/node-redis/node-redis.integration.spec.ts
 *
 * Environment variables:
 * - REDIS_HOST: Redis host (default: localhost)
 * - REDIS_PORT: Redis port (default: 6379)
 */
describe('Node-Redis Driver Integration', () => {
  let driver: IRedisDriver;

  beforeAll(async () => {
    const config: ISingleConnectionConfig = {
      type: 'single',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      connectTimeout: 10000,
    };

    driver = createDriver(config, { type: 'node-redis' });
    await driver.connect();
  });

  afterAll(async () => {
    if (driver && driver.isConnected()) {
      await driver.disconnect();
    }
  });

  describe('Basic Operations', () => {
    it('should set and get string values', async () => {
      // Given
      const key = 'test:node-redis:string';
      const value = 'Hello Node-Redis!';

      // When
      await driver.set(key, value);
      const result = await driver.get(key);

      // Then
      expect(result).toBe(value);

      // Cleanup
      await driver.del(key);
    });

    it('should handle numeric values', async () => {
      // Given
      const key = 'test:node-redis:number';

      // When
      await driver.set(key, '42');
      const result = await driver.get(key);

      // Then
      expect(result).toBe('42');

      // Cleanup
      await driver.del(key);
    });

    it('should return null for non-existent keys', async () => {
      // When
      const result = await driver.get('test:node-redis:nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should delete keys', async () => {
      // Given
      const key = 'test:node-redis:delete';
      await driver.set(key, 'to-delete');

      // When
      const deleted = await driver.del(key);

      // Then
      expect(deleted).toBe(1);

      const result = await driver.get(key);
      expect(result).toBeNull();
    });

    it('should check key existence', async () => {
      // Given
      const key = 'test:node-redis:exists';
      await driver.set(key, 'exists');

      // When
      const exists = await driver.exists(key);

      // Then
      expect(exists).toBe(1);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Set Options', () => {
    it('should set with expiration (EX)', async () => {
      // Given
      const key = 'test:node-redis:ex';

      // When
      await driver.set(key, 'expires', { ex: 2 });

      // Then
      const value = await driver.get(key);
      expect(value).toBe('expires');

      const ttl = await driver.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);

      // Cleanup
      await driver.del(key);
    });

    it('should set with expiration (PX)', async () => {
      // Given
      const key = 'test:node-redis:px';

      // When
      await driver.set(key, 'expires-ms', { px: 2000 });

      // Then
      const value = await driver.get(key);
      expect(value).toBe('expires-ms');

      const ttl = await driver.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2000);

      // Cleanup
      await driver.del(key);
    });

    it('should set with NX (only if not exists)', async () => {
      // Given
      const key = 'test:node-redis:nx';
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
      const key = 'test:node-redis:xx';

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
      const key = 'test:node-redis:hash';

      // When
      await driver.hset(key, 'field1', 'value1');
      await driver.hset(key, 'field2', 'value2');

      // Then
      const value1 = await driver.hget(key, 'field1');
      const value2 = await driver.hget(key, 'field2');

      expect(value1).toBe('value1');
      expect(value2).toBe('value2');

      // Cleanup
      await driver.del(key);
    });

    it('should get all hash fields', async () => {
      // Given
      const key = 'test:node-redis:hash:all';
      await driver.hset(key, 'name', 'Alice');
      await driver.hset(key, 'age', '30');

      // When
      const all = await driver.hgetall(key);

      // Then
      expect(all).toEqual({ name: 'Alice', age: '30' });

      // Cleanup
      await driver.del(key);
    });

    it('should delete hash fields', async () => {
      // Given
      const key = 'test:node-redis:hash:del';
      await driver.hset(key, 'field1', 'value1');
      await driver.hset(key, 'field2', 'value2');

      // When
      const deleted = await driver.hdel(key, 'field1');

      // Then
      expect(deleted).toBe(1);

      const value = await driver.hget(key, 'field1');
      expect(value).toBeNull();

      // Cleanup
      await driver.del(key);
    });
  });

  describe('List Operations', () => {
    it('should push and pop from lists', async () => {
      // Given
      const key = 'test:node-redis:list';

      // When
      await driver.lpush(key, 'item1', 'item2', 'item3');

      // Then
      const length = await driver.llen(key);
      expect(length).toBe(3);

      const items = await driver.lrange(key, 0, -1);
      expect(items).toEqual(['item3', 'item2', 'item1']);

      // Cleanup
      await driver.del(key);
    });

    it('should get list range', async () => {
      // Given
      const key = 'test:node-redis:list:range';
      await driver.rpush(key, 'a', 'b', 'c', 'd', 'e');

      // When
      const range = await driver.lrange(key, 1, 3);

      // Then
      expect(range).toEqual(['b', 'c', 'd']);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Set Operations', () => {
    it('should add and retrieve set members', async () => {
      // Given
      const key = 'test:node-redis:set';

      // When
      await driver.sadd(key, 'member1', 'member2', 'member3');

      // Then
      const members = await driver.smembers(key);
      expect(members).toHaveLength(3);
      expect(members).toContain('member1');
      expect(members).toContain('member2');
      expect(members).toContain('member3');

      // Cleanup
      await driver.del(key);
    });

    it('should check set membership', async () => {
      // Given
      const key = 'test:node-redis:set:member';
      await driver.sadd(key, 'apple', 'banana');

      // When
      const isMember = await driver.sismember(key, 'apple');
      const isNotMember = await driver.sismember(key, 'cherry');

      // Then
      expect(isMember).toBe(1);
      expect(isNotMember).toBe(0);

      // Cleanup
      await driver.del(key);
    });

    it('should get set cardinality', async () => {
      // Given
      const key = 'test:node-redis:set:card';
      await driver.sadd(key, 'a', 'b', 'c');

      // When
      const count = await driver.scard(key);

      // Then
      expect(count).toBe(3);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Sorted Set Operations', () => {
    it('should add and retrieve sorted set members', async () => {
      // Given
      const key = 'test:node-redis:zset';

      // When
      await driver.zadd(key, 1, 'member1');
      await driver.zadd(key, 2, 'member2');
      await driver.zadd(key, 3, 'member3');

      // Then
      const members = await driver.zrange(key, 0, -1);
      expect(members).toEqual(['member1', 'member2', 'member3']);

      // Cleanup
      await driver.del(key);
    });

    it('should get sorted set cardinality', async () => {
      // Given
      const key = 'test:node-redis:zset:card';
      await driver.zadd(key, 1, 'a');
      await driver.zadd(key, 2, 'b');

      // When
      const count = await driver.zcard(key);

      // Then
      expect(count).toBe(2);

      // Cleanup
      await driver.del(key);
    });

    it('should get member score', async () => {
      // Given
      const key = 'test:node-redis:zset:score';
      await driver.zadd(key, 100, 'member');

      // When
      const score = await driver.zscore(key, 'member');

      // Then
      expect(score).toBe('100');

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Expiration Operations', () => {
    it('should set and get TTL', async () => {
      // Given
      const key = 'test:node-redis:ttl';
      await driver.set(key, 'value');

      // When
      await driver.expire(key, 10);
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);

      // Cleanup
      await driver.del(key);
    });

    it('should persist keys', async () => {
      // Given
      const key = 'test:node-redis:persist';
      await driver.set(key, 'value', { ex: 100 });

      // When
      await driver.persist(key);
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBe(-1);

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipelined commands', async () => {
      // Given
      const keys = ['test:node-redis:pipe:1', 'test:node-redis:pipe:2', 'test:node-redis:pipe:3'];

      // When
      const pipeline = driver.pipeline();
      keys.forEach((key, i) => {
        pipeline.set(key, `value${i}`);
      });
      const results = await pipeline.exec();

      // Then
      expect(results).toHaveLength(3);
      results.forEach((result: [Error | null, unknown]) => {
        expect(result[0]).toBeNull(); // No error
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
  });

  describe('Multi/Exec Operations', () => {
    it('should execute transactions', async () => {
      // Given
      const key = 'test:node-redis:multi';

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

      // Cleanup
      await driver.del(key);
    });
  });

  describe('Increment Operations', () => {
    it('should increment numeric values', async () => {
      // Given
      const key = 'test:node-redis:incr';
      await driver.set(key, '10');

      // When
      const result1 = await driver.incr(key);
      const result2 = await driver.incr(key);

      // Then
      expect(result1).toBe(11);
      expect(result2).toBe(12);

      // Cleanup
      await driver.del(key);
    });

    it('should increment by specific amount', async () => {
      // Given
      const key = 'test:node-redis:incrby';
      await driver.set(key, '5');

      // When
      const result = await driver.incrby(key, 10);

      // Then
      expect(result).toBe(15);

      // Cleanup
      await driver.del(key);
    });

    it('should decrement numeric values', async () => {
      // Given
      const key = 'test:node-redis:decr';
      await driver.set(key, '10');

      // When
      const result1 = await driver.decr(key);
      const result2 = await driver.decr(key);

      // Then
      expect(result1).toBe(9);
      expect(result2).toBe(8);

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
});
