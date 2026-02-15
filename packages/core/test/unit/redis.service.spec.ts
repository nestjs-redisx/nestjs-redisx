/**
 * Unit tests for RedisService.
 *
 * RedisService is a convenient wrapper over RedisClientManager that provides
 * direct access to Redis operations without manual client management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisService } from '../../src/application/redis.service';
import { RedisClientManager } from '../../src/client';
import { createMockRedisDriver, createMockPipeline, createMockMulti } from '../mocks/redis.mock';
import type { IRedisDriver } from '../../src/interfaces';
import { DEFAULT_CLIENT_NAME } from '../../src/shared/constants';

describe('RedisService', () => {
  let service: RedisService;
  let clientManager: RedisClientManager;
  let mockDriver: ReturnType<typeof createMockRedisDriver>;

  beforeEach(() => {
    mockDriver = createMockRedisDriver();
    clientManager = new RedisClientManager();
    vi.spyOn(clientManager, 'getClient').mockResolvedValue(mockDriver as unknown as IRedisDriver);
    service = new RedisService(clientManager);
  });

  describe('getDriver', () => {
    it('should lazy load driver on first access', async () => {
      // When
      await service.get('test:key');

      // Then
      expect(clientManager.getClient).toHaveBeenCalledWith(DEFAULT_CLIENT_NAME);
      expect(mockDriver.get).toHaveBeenCalledWith('test:key');
    });

    it('should cache driver after first access', async () => {
      // When
      await service.get('key1');
      await service.get('key2');

      // Then
      expect(clientManager.getClient).toHaveBeenCalledTimes(1);
      expect(mockDriver.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getClient', () => {
    it('should get default client when no name provided', async () => {
      // When
      const result = await service.getClient();

      // Then
      expect(clientManager.getClient).toHaveBeenCalledWith(DEFAULT_CLIENT_NAME);
      expect(result).toBe(mockDriver);
    });

    it('should get named client', async () => {
      // When
      const result = await service.getClient('sessions');

      // Then
      expect(clientManager.getClient).toHaveBeenCalledWith('sessions');
      expect(result).toBe(mockDriver);
    });
  });

  // ========================================
  // Connection Management
  // ========================================

  describe('Connection', () => {
    it('should check if connected', async () => {
      // Given
      mockDriver.isConnected.mockReturnValue(true);

      // When
      const result = await service.isConnected();

      // Then
      expect(result).toBe(true);
      expect(mockDriver.isConnected).toHaveBeenCalled();
    });

    it('should ping server without message', async () => {
      // Given
      mockDriver.ping.mockResolvedValue('PONG');

      // When
      const result = await service.ping();

      // Then
      expect(result).toBe('PONG');
      expect(mockDriver.ping).toHaveBeenCalledWith(undefined);
    });

    it('should ping server with custom message', async () => {
      // Given
      mockDriver.ping.mockResolvedValue('hello');

      // When
      const result = await service.ping('hello');

      // Then
      expect(result).toBe('hello');
      expect(mockDriver.ping).toHaveBeenCalledWith('hello');
    });

    it('should select database', async () => {
      // Given
      mockDriver.select.mockResolvedValue(undefined);

      // When
      await service.select(2);

      // Then
      expect(mockDriver.select).toHaveBeenCalledWith(2);
    });
  });

  // ========================================
  // String Commands
  // ========================================

  describe('String Operations', () => {
    it('should get value', async () => {
      // Given
      mockDriver.get.mockResolvedValue('value');

      // When
      const result = await service.get('key');

      // Then
      expect(result).toBe('value');
      expect(mockDriver.get).toHaveBeenCalledWith('key');
    });

    it('should get null for non-existent key', async () => {
      // Given
      mockDriver.get.mockResolvedValue(null);

      // When
      const result = await service.get('nonexistent');

      // Then
      expect(result).toBeNull();
    });

    it('should set value without options', async () => {
      // Given
      mockDriver.set.mockResolvedValue('OK');

      // When
      const result = await service.set('key', 'value');

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.set).toHaveBeenCalledWith('key', 'value', undefined);
    });

    it('should set value with expiration', async () => {
      // Given
      mockDriver.set.mockResolvedValue('OK');

      // When
      await service.set('key', 'value', { ex: 60 });

      // Then
      expect(mockDriver.set).toHaveBeenCalledWith('key', 'value', { ex: 60 });
    });

    it('should get multiple values', async () => {
      // Given
      mockDriver.mget.mockResolvedValue(['val1', 'val2', null]);

      // When
      const result = await service.mget('key1', 'key2', 'key3');

      // Then
      expect(result).toEqual(['val1', 'val2', null]);
      expect(mockDriver.mget).toHaveBeenCalledWith('key1', 'key2', 'key3');
    });

    it('should set multiple values', async () => {
      // Given
      mockDriver.mset.mockResolvedValue('OK');

      // When
      const result = await service.mset({ key1: 'val1', key2: 'val2' });

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.mset).toHaveBeenCalledWith({ key1: 'val1', key2: 'val2' });
    });

    it('should set if not exists', async () => {
      // Given
      mockDriver.setnx.mockResolvedValue(1);

      // When
      const result = await service.setnx('key', 'value');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.setnx).toHaveBeenCalledWith('key', 'value');
    });

    it('should set with expiration (setex)', async () => {
      // Given
      mockDriver.setex.mockResolvedValue('OK');

      // When
      const result = await service.setex('key', 60, 'value');

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.setex).toHaveBeenCalledWith('key', 60, 'value');
    });

    it('should get and delete key', async () => {
      // Given
      mockDriver.getdel.mockResolvedValue('value');

      // When
      const result = await service.getdel('key');

      // Then
      expect(result).toBe('value');
      expect(mockDriver.getdel).toHaveBeenCalledWith('key');
    });

    it('should get and set expiration', async () => {
      // Given
      mockDriver.getex.mockResolvedValue('value');

      // When
      const result = await service.getex('key', { ex: 60 });

      // Then
      expect(result).toBe('value');
      expect(mockDriver.getex).toHaveBeenCalledWith('key', { ex: 60 });
    });

    it('should increment value', async () => {
      // Given
      mockDriver.incr.mockResolvedValue(1);

      // When
      const result = await service.incr('counter');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.incr).toHaveBeenCalledWith('counter');
    });

    it('should increment by amount', async () => {
      // Given
      mockDriver.incrby.mockResolvedValue(10);

      // When
      const result = await service.incrby('counter', 5);

      // Then
      expect(result).toBe(10);
      expect(mockDriver.incrby).toHaveBeenCalledWith('counter', 5);
    });

    it('should decrement value', async () => {
      // Given
      mockDriver.decr.mockResolvedValue(9);

      // When
      const result = await service.decr('counter');

      // Then
      expect(result).toBe(9);
      expect(mockDriver.decr).toHaveBeenCalledWith('counter');
    });

    it('should decrement by amount', async () => {
      // Given
      mockDriver.decrby.mockResolvedValue(5);

      // When
      const result = await service.decrby('counter', 5);

      // Then
      expect(result).toBe(5);
      expect(mockDriver.decrby).toHaveBeenCalledWith('counter', 5);
    });

    it('should append to value', async () => {
      // Given
      mockDriver.append.mockResolvedValue(11);

      // When
      const result = await service.append('key', ' world');

      // Then
      expect(result).toBe(11);
      expect(mockDriver.append).toHaveBeenCalledWith('key', ' world');
    });
  });

  // ========================================
  // Key Management
  // ========================================

  describe('Key Management', () => {
    it('should delete single key', async () => {
      // Given
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await service.del('key');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.del).toHaveBeenCalledWith('key');
    });

    it('should delete multiple keys', async () => {
      // Given
      mockDriver.del.mockResolvedValue(3);

      // When
      const result = await service.del('key1', 'key2', 'key3');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.del).toHaveBeenCalledWith('key1', 'key2', 'key3');
    });

    it('should check if key exists', async () => {
      // Given
      mockDriver.exists.mockResolvedValue(1);

      // When
      const result = await service.exists('key');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.exists).toHaveBeenCalledWith('key');
    });

    it('should check multiple keys existence', async () => {
      // Given
      mockDriver.exists.mockResolvedValue(2);

      // When
      const result = await service.exists('key1', 'key2');

      // Then
      expect(result).toBe(2);
    });

    it('should set expiration in seconds', async () => {
      // Given
      mockDriver.expire.mockResolvedValue(1);

      // When
      const result = await service.expire('key', 60);

      // Then
      expect(result).toBe(1);
      expect(mockDriver.expire).toHaveBeenCalledWith('key', 60);
    });

    it('should set expiration in milliseconds', async () => {
      // Given
      mockDriver.pexpire.mockResolvedValue(1);

      // When
      const result = await service.pexpire('key', 60000);

      // Then
      expect(result).toBe(1);
      expect(mockDriver.pexpire).toHaveBeenCalledWith('key', 60000);
    });

    it('should set expiration at timestamp', async () => {
      // Given
      const timestamp = Math.floor(Date.now() / 1000) + 3600;
      mockDriver.expireat.mockResolvedValue(1);

      // When
      const result = await service.expireat('key', timestamp);

      // Then
      expect(result).toBe(1);
      expect(mockDriver.expireat).toHaveBeenCalledWith('key', timestamp);
    });

    it('should get TTL in seconds', async () => {
      // Given
      mockDriver.ttl.mockResolvedValue(60);

      // When
      const result = await service.ttl('key');

      // Then
      expect(result).toBe(60);
      expect(mockDriver.ttl).toHaveBeenCalledWith('key');
    });

    it('should get TTL in milliseconds', async () => {
      // Given
      mockDriver.pttl.mockResolvedValue(60000);

      // When
      const result = await service.pttl('key');

      // Then
      expect(result).toBe(60000);
      expect(mockDriver.pttl).toHaveBeenCalledWith('key');
    });

    it('should persist key (remove expiration)', async () => {
      // Given
      mockDriver.persist.mockResolvedValue(1);

      // When
      const result = await service.persist('key');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.persist).toHaveBeenCalledWith('key');
    });

    it('should rename key', async () => {
      // Given
      mockDriver.rename.mockResolvedValue('OK');

      // When
      const result = await service.rename('oldkey', 'newkey');

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.rename).toHaveBeenCalledWith('oldkey', 'newkey');
    });

    it('should rename key if new key does not exist', async () => {
      // Given
      mockDriver.renamenx.mockResolvedValue(1);

      // When
      const result = await service.renamenx('oldkey', 'newkey');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.renamenx).toHaveBeenCalledWith('oldkey', 'newkey');
    });

    it('should get key type', async () => {
      // Given
      mockDriver.type.mockResolvedValue('string');

      // When
      const result = await service.type('key');

      // Then
      expect(result).toBe('string');
      expect(mockDriver.type).toHaveBeenCalledWith('key');
    });

    it('should scan keys', async () => {
      // Given
      mockDriver.scan.mockResolvedValue(['0', ['key1', 'key2']]);

      // When
      const result = await service.scan(0, { match: 'test:*', count: 10 });

      // Then
      expect(result).toEqual(['0', ['key1', 'key2']]);
      expect(mockDriver.scan).toHaveBeenCalledWith(0, { match: 'test:*', count: 10 });
    });
  });

  // ========================================
  // Hash Commands
  // ========================================

  describe('Hash Operations', () => {
    it('should get hash field', async () => {
      // Given
      mockDriver.hget.mockResolvedValue('value');

      // When
      const result = await service.hget('hash', 'field');

      // Then
      expect(result).toBe('value');
      expect(mockDriver.hget).toHaveBeenCalledWith('hash', 'field');
    });

    it('should set hash field', async () => {
      // Given
      mockDriver.hset.mockResolvedValue(1);

      // When
      const result = await service.hset('hash', 'field', 'value');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.hset).toHaveBeenCalledWith('hash', 'field', 'value');
    });

    it('should set multiple hash fields', async () => {
      // Given
      mockDriver.hmset.mockResolvedValue('OK');

      // When
      const result = await service.hmset('hash', { field1: 'val1', field2: 'val2' });

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.hmset).toHaveBeenCalledWith('hash', { field1: 'val1', field2: 'val2' });
    });

    it('should get multiple hash fields', async () => {
      // Given
      mockDriver.hmget.mockResolvedValue(['val1', 'val2', null]);

      // When
      const result = await service.hmget('hash', 'field1', 'field2', 'field3');

      // Then
      expect(result).toEqual(['val1', 'val2', null]);
      expect(mockDriver.hmget).toHaveBeenCalledWith('hash', 'field1', 'field2', 'field3');
    });

    it('should get all hash fields and values', async () => {
      // Given
      mockDriver.hgetall.mockResolvedValue({ field1: 'val1', field2: 'val2' });

      // When
      const result = await service.hgetall('hash');

      // Then
      expect(result).toEqual({ field1: 'val1', field2: 'val2' });
      expect(mockDriver.hgetall).toHaveBeenCalledWith('hash');
    });

    it('should delete hash fields', async () => {
      // Given
      mockDriver.hdel.mockResolvedValue(2);

      // When
      const result = await service.hdel('hash', 'field1', 'field2');

      // Then
      expect(result).toBe(2);
      expect(mockDriver.hdel).toHaveBeenCalledWith('hash', 'field1', 'field2');
    });

    it('should check if hash field exists', async () => {
      // Given
      mockDriver.hexists.mockResolvedValue(1);

      // When
      const result = await service.hexists('hash', 'field');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.hexists).toHaveBeenCalledWith('hash', 'field');
    });

    it('should get hash field names', async () => {
      // Given
      mockDriver.hkeys.mockResolvedValue(['field1', 'field2']);

      // When
      const result = await service.hkeys('hash');

      // Then
      expect(result).toEqual(['field1', 'field2']);
      expect(mockDriver.hkeys).toHaveBeenCalledWith('hash');
    });

    it('should get hash values', async () => {
      // Given
      mockDriver.hvals.mockResolvedValue(['val1', 'val2']);

      // When
      const result = await service.hvals('hash');

      // Then
      expect(result).toEqual(['val1', 'val2']);
      expect(mockDriver.hvals).toHaveBeenCalledWith('hash');
    });

    it('should get hash length', async () => {
      // Given
      mockDriver.hlen.mockResolvedValue(3);

      // When
      const result = await service.hlen('hash');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.hlen).toHaveBeenCalledWith('hash');
    });

    it('should increment hash field', async () => {
      // Given
      mockDriver.hincrby.mockResolvedValue(10);

      // When
      const result = await service.hincrby('hash', 'counter', 5);

      // Then
      expect(result).toBe(10);
      expect(mockDriver.hincrby).toHaveBeenCalledWith('hash', 'counter', 5);
    });

    it('should scan hash fields', async () => {
      // Given
      mockDriver.hscan.mockResolvedValue(['0', ['field1', 'val1', 'field2', 'val2']]);

      // When
      const result = await service.hscan('hash', 0, { match: 'field*' });

      // Then
      expect(result).toEqual(['0', ['field1', 'val1', 'field2', 'val2']]);
      expect(mockDriver.hscan).toHaveBeenCalledWith('hash', 0, { match: 'field*' });
    });
  });

  // ========================================
  // List Commands
  // ========================================

  describe('List Operations', () => {
    it('should push to left of list', async () => {
      // Given
      mockDriver.lpush.mockResolvedValue(3);

      // When
      const result = await service.lpush('list', 'val1', 'val2', 'val3');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.lpush).toHaveBeenCalledWith('list', 'val1', 'val2', 'val3');
    });

    it('should push to right of list', async () => {
      // Given
      mockDriver.rpush.mockResolvedValue(3);

      // When
      const result = await service.rpush('list', 'val1', 'val2', 'val3');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.rpush).toHaveBeenCalledWith('list', 'val1', 'val2', 'val3');
    });

    it('should pop from left of list', async () => {
      // Given
      mockDriver.lpop.mockResolvedValue('val1');

      // When
      const result = await service.lpop('list');

      // Then
      expect(result).toBe('val1');
      expect(mockDriver.lpop).toHaveBeenCalledWith('list');
    });

    it('should pop from right of list', async () => {
      // Given
      mockDriver.rpop.mockResolvedValue('val3');

      // When
      const result = await service.rpop('list');

      // Then
      expect(result).toBe('val3');
      expect(mockDriver.rpop).toHaveBeenCalledWith('list');
    });

    it('should get list length', async () => {
      // Given
      mockDriver.llen.mockResolvedValue(5);

      // When
      const result = await service.llen('list');

      // Then
      expect(result).toBe(5);
      expect(mockDriver.llen).toHaveBeenCalledWith('list');
    });

    it('should get list range', async () => {
      // Given
      mockDriver.lrange.mockResolvedValue(['val1', 'val2', 'val3']);

      // When
      const result = await service.lrange('list', 0, -1);

      // Then
      expect(result).toEqual(['val1', 'val2', 'val3']);
      expect(mockDriver.lrange).toHaveBeenCalledWith('list', 0, -1);
    });

    it('should trim list', async () => {
      // Given
      mockDriver.ltrim.mockResolvedValue('OK');

      // When
      const result = await service.ltrim('list', 0, 99);

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.ltrim).toHaveBeenCalledWith('list', 0, 99);
    });

    it('should get element at index', async () => {
      // Given
      mockDriver.lindex.mockResolvedValue('val2');

      // When
      const result = await service.lindex('list', 1);

      // Then
      expect(result).toBe('val2');
      expect(mockDriver.lindex).toHaveBeenCalledWith('list', 1);
    });

    it('should set element at index', async () => {
      // Given
      mockDriver.lset.mockResolvedValue('OK');

      // When
      const result = await service.lset('list', 1, 'newval');

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.lset).toHaveBeenCalledWith('list', 1, 'newval');
    });
  });

  // ========================================
  // Set Commands
  // ========================================

  describe('Set Operations', () => {
    it('should add members to set', async () => {
      // Given
      mockDriver.sadd.mockResolvedValue(3);

      // When
      const result = await service.sadd('set', 'mem1', 'mem2', 'mem3');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.sadd).toHaveBeenCalledWith('set', 'mem1', 'mem2', 'mem3');
    });

    it('should remove members from set', async () => {
      // Given
      mockDriver.srem.mockResolvedValue(2);

      // When
      const result = await service.srem('set', 'mem1', 'mem2');

      // Then
      expect(result).toBe(2);
      expect(mockDriver.srem).toHaveBeenCalledWith('set', 'mem1', 'mem2');
    });

    it('should get all set members', async () => {
      // Given
      mockDriver.smembers.mockResolvedValue(['mem1', 'mem2', 'mem3']);

      // When
      const result = await service.smembers('set');

      // Then
      expect(result).toEqual(['mem1', 'mem2', 'mem3']);
      expect(mockDriver.smembers).toHaveBeenCalledWith('set');
    });

    it('should check if member is in set', async () => {
      // Given
      mockDriver.sismember.mockResolvedValue(1);

      // When
      const result = await service.sismember('set', 'mem1');

      // Then
      expect(result).toBe(1);
      expect(mockDriver.sismember).toHaveBeenCalledWith('set', 'mem1');
    });

    it('should get set cardinality', async () => {
      // Given
      mockDriver.scard.mockResolvedValue(5);

      // When
      const result = await service.scard('set');

      // Then
      expect(result).toBe(5);
      expect(mockDriver.scard).toHaveBeenCalledWith('set');
    });

    it('should get random member', async () => {
      // Given
      mockDriver.srandmember.mockResolvedValue('mem2');

      // When
      const result = await service.srandmember('set');

      // Then
      expect(result).toBe('mem2');
      expect(mockDriver.srandmember).toHaveBeenCalledWith('set', undefined);
    });

    it('should get multiple random members', async () => {
      // Given
      mockDriver.srandmember.mockResolvedValue(['mem1', 'mem3']);

      // When
      const result = await service.srandmember('set', 2);

      // Then
      expect(result).toEqual(['mem1', 'mem3']);
      expect(mockDriver.srandmember).toHaveBeenCalledWith('set', 2);
    });

    it('should pop random member', async () => {
      // Given
      mockDriver.spop.mockResolvedValue('mem1');

      // When
      const result = await service.spop('set');

      // Then
      expect(result).toBe('mem1');
      expect(mockDriver.spop).toHaveBeenCalledWith('set', undefined);
    });

    it('should scan set members', async () => {
      // Given
      mockDriver.sscan.mockResolvedValue(['0', ['mem1', 'mem2']]);

      // When
      const result = await service.sscan('set', 0, { match: 'mem*' });

      // Then
      expect(result).toEqual(['0', ['mem1', 'mem2']]);
      expect(mockDriver.sscan).toHaveBeenCalledWith('set', 0, { match: 'mem*' });
    });
  });

  // ========================================
  // Sorted Set Commands
  // ========================================

  describe('Sorted Set Operations', () => {
    it('should add members to sorted set', async () => {
      // Given
      mockDriver.zadd.mockResolvedValue(3);

      // When
      const result = await service.zadd('zset', 1, 'mem1', 2, 'mem2', 3, 'mem3');

      // Then
      expect(result).toBe(3);
      expect(mockDriver.zadd).toHaveBeenCalledWith('zset', 1, 'mem1', 2, 'mem2', 3, 'mem3');
    });

    it('should remove members from sorted set', async () => {
      // Given
      mockDriver.zrem.mockResolvedValue(2);

      // When
      const result = await service.zrem('zset', 'mem1', 'mem2');

      // Then
      expect(result).toBe(2);
      expect(mockDriver.zrem).toHaveBeenCalledWith('zset', 'mem1', 'mem2');
    });

    it('should get range by index', async () => {
      // Given
      mockDriver.zrange.mockResolvedValue(['mem1', 'mem2', 'mem3']);

      // When
      const result = await service.zrange('zset', 0, -1);

      // Then
      expect(result).toEqual(['mem1', 'mem2', 'mem3']);
      expect(mockDriver.zrange).toHaveBeenCalledWith('zset', 0, -1, undefined);
    });

    it('should get range by index with scores', async () => {
      // Given
      mockDriver.zrange.mockResolvedValue(['mem1', '1', 'mem2', '2']);

      // When
      const result = await service.zrange('zset', 0, -1, true);

      // Then
      expect(result).toEqual(['mem1', '1', 'mem2', '2']);
      expect(mockDriver.zrange).toHaveBeenCalledWith('zset', 0, -1, true);
    });

    it('should get range by score', async () => {
      // Given
      mockDriver.zrangebyscore.mockResolvedValue(['mem2', 'mem3']);

      // When
      const result = await service.zrangebyscore('zset', 2, 3);

      // Then
      expect(result).toEqual(['mem2', 'mem3']);
      expect(mockDriver.zrangebyscore).toHaveBeenCalledWith('zset', 2, 3, undefined);
    });

    it('should get member score', async () => {
      // Given
      mockDriver.zscore.mockResolvedValue('42');

      // When
      const result = await service.zscore('zset', 'member');

      // Then
      expect(result).toBe('42');
      expect(mockDriver.zscore).toHaveBeenCalledWith('zset', 'member');
    });

    it('should get sorted set cardinality', async () => {
      // Given
      mockDriver.zcard.mockResolvedValue(5);

      // When
      const result = await service.zcard('zset');

      // Then
      expect(result).toBe(5);
      expect(mockDriver.zcard).toHaveBeenCalledWith('zset');
    });

    it('should get member rank', async () => {
      // Given
      mockDriver.zrank.mockResolvedValue(2);

      // When
      const result = await service.zrank('zset', 'mem3');

      // Then
      expect(result).toBe(2);
      expect(mockDriver.zrank).toHaveBeenCalledWith('zset', 'mem3');
    });

    it('should increment member score', async () => {
      // Given
      mockDriver.zincrby.mockResolvedValue('47');

      // When
      const result = await service.zincrby('zset', 5, 'member');

      // Then
      expect(result).toBe('47');
      expect(mockDriver.zincrby).toHaveBeenCalledWith('zset', 5, 'member');
    });

    it('should scan sorted set members', async () => {
      // Given
      mockDriver.zscan.mockResolvedValue(['0', ['mem1', '1', 'mem2', '2']]);

      // When
      const result = await service.zscan('zset', 0, { match: 'mem*' });

      // Then
      expect(result).toEqual(['0', ['mem1', '1', 'mem2', '2']]);
      expect(mockDriver.zscan).toHaveBeenCalledWith('zset', 0, { match: 'mem*' });
    });
  });

  // ========================================
  // Pub/Sub Commands
  // ========================================

  describe('Pub/Sub Operations', () => {
    it('should publish message', async () => {
      // Given
      mockDriver.publish.mockResolvedValue(5);

      // When
      const result = await service.publish('channel', 'message');

      // Then
      expect(result).toBe(5);
      expect(mockDriver.publish).toHaveBeenCalledWith('channel', 'message');
    });

    it('should subscribe to channels', async () => {
      // Given
      mockDriver.subscribe.mockResolvedValue(undefined);

      // When
      await service.subscribe('channel1', 'channel2');

      // Then
      expect(mockDriver.subscribe).toHaveBeenCalledWith('channel1', 'channel2');
    });

    it('should unsubscribe from channels', async () => {
      // Given
      mockDriver.unsubscribe.mockResolvedValue(undefined);

      // When
      await service.unsubscribe('channel1', 'channel2');

      // Then
      expect(mockDriver.unsubscribe).toHaveBeenCalledWith('channel1', 'channel2');
    });

    it('should subscribe to pattern', async () => {
      // Given
      mockDriver.psubscribe.mockResolvedValue(undefined);

      // When
      await service.psubscribe('channel:*', 'user:*');

      // Then
      expect(mockDriver.psubscribe).toHaveBeenCalledWith('channel:*', 'user:*');
    });

    it('should unsubscribe from pattern', async () => {
      // Given
      mockDriver.punsubscribe.mockResolvedValue(undefined);

      // When
      await service.punsubscribe('channel:*');

      // Then
      expect(mockDriver.punsubscribe).toHaveBeenCalledWith('channel:*');
    });
  });

  // ========================================
  // Transaction Commands
  // ========================================

  describe('Transaction Operations', () => {
    it('should create pipeline', async () => {
      // Given
      const mockPipeline = createMockPipeline();
      mockDriver.pipeline.mockReturnValue(mockPipeline as any);

      // When
      const result = await service.pipeline();

      // Then
      expect(result).toBe(mockPipeline);
      expect(mockDriver.pipeline).toHaveBeenCalled();
    });

    it('should create multi transaction', async () => {
      // Given
      const mockMulti = createMockMulti();
      mockDriver.multi.mockReturnValue(mockMulti as any);

      // When
      const result = await service.multi();

      // Then
      expect(result).toBe(mockMulti);
      expect(mockDriver.multi).toHaveBeenCalled();
    });
  });

  // ========================================
  // Lua Script Commands
  // ========================================

  describe('Lua Script Operations', () => {
    it('should evaluate Lua script', async () => {
      // Given
      mockDriver.eval.mockResolvedValue(42);

      // When
      const result = await service.eval('return 42', [], []);

      // Then
      expect(result).toBe(42);
      expect(mockDriver.eval).toHaveBeenCalledWith('return 42', [], []);
    });

    it('should evaluate Lua script with keys and args', async () => {
      // Given
      mockDriver.eval.mockResolvedValue('OK');

      // When
      await service.eval('return redis.call("SET", KEYS[1], ARGV[1])', ['key'], ['value']);

      // Then
      expect(mockDriver.eval).toHaveBeenCalledWith('return redis.call("SET", KEYS[1], ARGV[1])', ['key'], ['value']);
    });

    it('should evaluate script by SHA', async () => {
      // Given
      const sha = 'abc123';
      mockDriver.evalsha.mockResolvedValue('result');

      // When
      const result = await service.evalsha(sha, ['key'], [1, 'arg']);

      // Then
      expect(result).toBe('result');
      expect(mockDriver.evalsha).toHaveBeenCalledWith(sha, ['key'], [1, 'arg']);
    });

    it('should load script and return SHA', async () => {
      // Given
      const sha = 'abc123def456';
      mockDriver.scriptLoad.mockResolvedValue(sha);

      // When
      const result = await service.scriptLoad('return 42');

      // Then
      expect(result).toBe(sha);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith('return 42');
    });

    it('should check if scripts exist', async () => {
      // Given
      mockDriver.scriptExists.mockResolvedValue([1, 0, 1]);

      // When
      const result = await service.scriptExists('sha1', 'sha2', 'sha3');

      // Then
      expect(result).toEqual([1, 0, 1]);
      expect(mockDriver.scriptExists).toHaveBeenCalledWith('sha1', 'sha2', 'sha3');
    });

    it('should flush script cache', async () => {
      // Given
      mockDriver.scriptFlush.mockResolvedValue('OK');

      // When
      const result = await service.scriptFlush();

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.scriptFlush).toHaveBeenCalled();
    });
  });

  // ========================================
  // Server Commands
  // ========================================

  describe('Server Operations', () => {
    it('should flush database', async () => {
      // Given
      mockDriver.flushdb.mockResolvedValue('OK');

      // When
      const result = await service.flushdb();

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.flushdb).toHaveBeenCalled();
    });

    it('should flush all databases', async () => {
      // Given
      mockDriver.flushall.mockResolvedValue('OK');

      // When
      const result = await service.flushall();

      // Then
      expect(result).toBe('OK');
      expect(mockDriver.flushall).toHaveBeenCalled();
    });

    it('should get server info without section', async () => {
      // Given
      mockDriver.info.mockResolvedValue('redis_version:7.0.0');

      // When
      const result = await service.info();

      // Then
      expect(result).toBe('redis_version:7.0.0');
      expect(mockDriver.info).toHaveBeenCalledWith(undefined);
    });

    it('should get server info with section', async () => {
      // Given
      mockDriver.info.mockResolvedValue('used_memory:1024000');

      // When
      const result = await service.info('memory');

      // Then
      expect(result).toBe('used_memory:1024000');
      expect(mockDriver.info).toHaveBeenCalledWith('memory');
    });

    it('should get database size', async () => {
      // Given
      mockDriver.dbsize.mockResolvedValue(1337);

      // When
      const result = await service.dbsize();

      // Then
      expect(result).toBe(1337);
      expect(mockDriver.dbsize).toHaveBeenCalled();
    });
  });

  // ========================================
  // Lifecycle
  // ========================================

  describe('Lifecycle', () => {
    it('should close all clients on module destroy', async () => {
      // Given
      vi.spyOn(clientManager, 'closeAll').mockResolvedValue(undefined);

      // When
      await service.onModuleDestroy();

      // Then
      expect(clientManager.closeAll).toHaveBeenCalled();
    });
  });
});
