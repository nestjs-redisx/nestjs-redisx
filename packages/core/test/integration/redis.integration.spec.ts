/**
 * Integration tests for Redis drivers.
 *
 * These tests require a running Redis instance.
 * Run with: docker-compose up -d redis
 *
 * To run integration tests: npm run test:integration
 * To skip integration tests: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDriver } from '../../src/driver/application/driver.factory';
import type { IRedisDriver } from '../../src/interfaces';
import type { ISingleConnectionConfig } from '../../src/types';

// Skip integration tests if SKIP_INTEGRATION env var is set
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

describeIntegration('Redis Integration Tests', () => {
  let driver: IRedisDriver;

  const config: ISingleConnectionConfig = {
    type: 'single',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: 0,
  };

  beforeAll(async () => {
    driver = createDriver(config, 'ioredis');
    await driver.connect();
  });

  afterAll(async () => {
    await driver.flushdb();
    await driver.disconnect();
  });

  describe('Connection', () => {
    it('should connect to Redis', async () => {
      // When
      const result = await driver.ping();

      // Then
      expect(result).toBe('PONG');
    });

    it('should return connected status', () => {
      // When
      const connected = driver.isConnected();

      // Then
      expect(connected).toBe(true);
    });
  });

  describe('String Operations', () => {
    it('should set and get string value', async () => {
      // Given
      const key = 'test:string';
      const value = 'hello world';

      // When
      await driver.set(key, value);
      const result = await driver.get(key);

      // Then
      expect(result).toBe(value);
    });

    it('should set with TTL', async () => {
      // Given
      const key = 'test:ttl';
      const value = 'expires soon';

      // When
      await driver.set(key, value, { ex: 10 });
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('should delete key', async () => {
      // Given
      const key = 'test:delete';
      await driver.set(key, 'value');

      // When
      const deleted = await driver.del(key);
      const result = await driver.get(key);

      // Then
      expect(deleted).toBe(1);
      expect(result).toBeNull();
    });

    it('should check key existence', async () => {
      // Given
      const key = 'test:exists';
      await driver.set(key, 'value');

      // When
      const exists = await driver.exists(key);
      await driver.del(key);
      const notExists = await driver.exists(key);

      // Then
      expect(exists).toBe(1);
      expect(notExists).toBe(0);
    });

    it('should increment counter', async () => {
      // Given
      const key = 'test:counter';

      // When
      const val1 = await driver.incr(key);
      const val2 = await driver.incr(key);
      const val3 = await driver.incrby(key, 5);

      // Then
      expect(val1).toBe(1);
      expect(val2).toBe(2);
      expect(val3).toBe(7);
    });

    it('should get multiple keys', async () => {
      // Given
      await driver.set('test:mget1', 'value1');
      await driver.set('test:mget2', 'value2');

      // When
      const values = await driver.mget('test:mget1', 'test:mget2', 'test:nonexistent');

      // Then
      expect(values).toHaveLength(3);
      expect(values[0]).toBe('value1');
      expect(values[1]).toBe('value2');
      expect(values[2]).toBeNull();
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash field', async () => {
      // Given
      const key = 'test:hash';

      // When
      await driver.hset(key, 'field1', 'value1');
      const result = await driver.hget(key, 'field1');

      // Then
      expect(result).toBe('value1');
    });

    it('should get all hash fields', async () => {
      // Given
      const key = 'test:hashall';
      await driver.hset(key, 'field1', 'value1');
      await driver.hset(key, 'field2', 'value2');

      // When
      const result = await driver.hgetall(key);

      // Then
      expect(result).toEqual({
        field1: 'value1',
        field2: 'value2',
      });
    });

    it('should delete hash field', async () => {
      // Given
      const key = 'test:hashdel';
      await driver.hset(key, 'field1', 'value1');

      // When
      const deleted = await driver.hdel(key, 'field1');
      const result = await driver.hget(key, 'field1');

      // Then
      expect(deleted).toBe(1);
      expect(result).toBeNull();
    });
  });

  describe('List Operations', () => {
    it('should push and pop from list', async () => {
      // Given
      const key = 'test:list';

      // When
      await driver.lpush(key, 'item1', 'item2');
      const popped = await driver.lpop(key);

      // Then
      expect(popped).toBe('item2'); // Last in, first out
    });

    it('should get list range', async () => {
      // Given
      const key = 'test:listrange';
      await driver.rpush(key, 'item1', 'item2', 'item3');

      // When
      const range = await driver.lrange(key, 0, -1);

      // Then
      expect(range).toEqual(['item1', 'item2', 'item3']);
    });

    it('should get list length', async () => {
      // Given
      const key = 'test:listlen';
      await driver.rpush(key, 'item1', 'item2', 'item3');

      // When
      const length = await driver.llen(key);

      // Then
      expect(length).toBe(3);
    });
  });

  describe('Set Operations', () => {
    it('should add and check set members', async () => {
      // Given
      const key = 'test:set';

      // When
      await driver.sadd(key, 'member1', 'member2');
      const isMember = await driver.sismember(key, 'member1');
      const notMember = await driver.sismember(key, 'nonexistent');

      // Then
      expect(isMember).toBe(1);
      expect(notMember).toBe(0);
    });

    it('should get all set members', async () => {
      // Given
      const key = 'test:setall';
      await driver.sadd(key, 'member1', 'member2', 'member3');

      // When
      const members = await driver.smembers(key);

      // Then
      expect(members).toHaveLength(3);
      expect(members).toContain('member1');
      expect(members).toContain('member2');
      expect(members).toContain('member3');
    });

    it('should get set cardinality', async () => {
      // Given
      const key = 'test:setcard';
      await driver.sadd(key, 'member1', 'member2');

      // When
      const card = await driver.scard(key);

      // Then
      expect(card).toBe(2);
    });
  });

  describe('Sorted Set Operations', () => {
    it('should add and get sorted set members', async () => {
      // Given
      const key = 'test:zset';

      // When
      await driver.zadd(key, 1, 'member1', 2, 'member2', 3, 'member3');
      const range = await driver.zrange(key, 0, -1);

      // Then
      expect(range).toEqual(['member1', 'member2', 'member3']);
    });

    it('should get sorted set by score', async () => {
      // Given
      const key = 'test:zsetbyscore';
      await driver.zadd(key, 1, 'one', 2, 'two', 3, 'three', 4, 'four');

      // When
      const range = await driver.zrangebyscore(key, 2, 3);

      // Then
      expect(range).toEqual(['two', 'three']);
    });

    it('should get member score', async () => {
      // Given
      const key = 'test:zsetscore';
      await driver.zadd(key, 42, 'member');

      // When
      const score = await driver.zscore(key, 'member');

      // Then
      expect(score).toBe('42');
    });
  });

  describe('Pipeline', () => {
    it('should execute pipeline commands', async () => {
      // Given
      const pipeline = driver.pipeline();

      // When
      pipeline.set('test:pipe1', 'value1');
      pipeline.set('test:pipe2', 'value2');
      pipeline.get('test:pipe1');
      pipeline.get('test:pipe2');

      const results = await pipeline.exec();

      // Then
      expect(results).toBeDefined();
      expect(results).toHaveLength(4);
    });
  });

  describe('Transaction', () => {
    it('should execute transaction', async () => {
      // Given
      const multi = driver.multi();

      // When
      multi.set('test:tx1', 'value1');
      multi.set('test:tx2', 'value2');
      multi.get('test:tx1');

      const results = await multi.exec();

      // Then
      expect(results).toBeDefined();
      expect(results).toHaveLength(3);
    });
  });

  describe('TTL and Expiration', () => {
    it('should set expiration on existing key', async () => {
      // Given
      const key = 'test:expire';
      await driver.set(key, 'value');

      // When
      await driver.expire(key, 10);
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('should return -1 for keys without TTL', async () => {
      // Given
      const key = 'test:nottl';
      await driver.set(key, 'value');

      // When
      const ttl = await driver.ttl(key);

      // Then
      expect(ttl).toBe(-1);
    });

    it('should return -2 for non-existent keys', async () => {
      // When
      const ttl = await driver.ttl('test:nonexistent');

      // Then
      expect(ttl).toBe(-2);
    });
  });

  describe('Scan', () => {
    it('should scan keys', async () => {
      // Given - use unique prefix to avoid conflicts with other tests
      const prefix = `test:scan:${Date.now()}`;
      await driver.set(`${prefix}:1`, 'value1');
      await driver.set(`${prefix}:2`, 'value2');
      await driver.set(`${prefix}:3`, 'value3');

      // When - iterate through all scan results (SCAN doesn't guarantee all keys in one call)
      const allKeys: string[] = [];
      let cursor = '0';
      do {
        const result = await driver.scan(cursor, {
          match: `${prefix}:*`,
          count: 100,
        });
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        cursor = result[0];
        allKeys.push(...(result[1] as string[]));
      } while (cursor !== '0');

      // Then
      expect(allKeys.length).toBeGreaterThan(0);
      expect(allKeys).toContain(`${prefix}:1`);
      expect(allKeys).toContain(`${prefix}:2`);
      expect(allKeys).toContain(`${prefix}:3`);

      // Cleanup
      await driver.del(`${prefix}:1`, `${prefix}:2`, `${prefix}:3`);
    });
  });

  describe('Database Operations', () => {
    it('should get database size', async () => {
      // When
      const size = await driver.dbsize();

      // Then
      expect(size).toBeGreaterThanOrEqual(0);
    });

    it('should flush database', async () => {
      // Given
      await driver.set('test:flush', 'value');

      // When
      await driver.flushdb();
      const result = await driver.get('test:flush');

      // Then
      expect(result).toBeNull();
    });
  });
});
