import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { BaseRedisDriver } from '../../src/driver/infrastructure/base.driver';
import { IPipeline, IMulti, DriverEvent, ISetOptions, IScanOptions } from '../../src/interfaces';
import { ConnectionConfig } from '../../src/types';
import { ConnectionError, CommandError } from '../../src/shared/errors';

/**
 * Concrete implementation of BaseRedisDriver for testing.
 */
class TestRedisDriver extends BaseRedisDriver {
  public mockPipeline: IPipeline;
  public mockMulti: IMulti;
  public doConnectSpy = vi.fn();
  public doDisconnectSpy = vi.fn();
  public executeCommandSpy = vi.fn();

  constructor(config: ConnectionConfig) {
    super(config, { enableLogging: false });

    // Mock pipeline
    this.mockPipeline = {
      exec: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      mget: vi.fn().mockReturnThis(),
      mset: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      ttl: vi.fn().mockReturnThis(),
      hget: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      hmset: vi.fn().mockReturnThis(),
      hgetall: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      rpush: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      srem: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      incrby: vi.fn().mockReturnThis(),
    };

    // Mock multi
    this.mockMulti = {
      ...this.mockPipeline,
      discard: vi.fn(),
    };
  }

  protected async doConnect(): Promise<void> {
    await this.doConnectSpy();
  }

  protected async doDisconnect(): Promise<void> {
    await this.doDisconnectSpy();
  }

  protected async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    return this.executeCommandSpy(command, ...args);
  }

  protected createPipeline(): IPipeline {
    return this.mockPipeline;
  }

  protected createMulti(): IMulti {
    return this.mockMulti;
  }
}

describe('BaseRedisDriver', () => {
  let driver: TestRedisDriver;
  let config: ConnectionConfig;

  beforeEach(() => {
    config = {
      type: 'single',
      host: 'localhost',
      port: 6379,
    };
    driver = new TestRedisDriver(config);
  });

  describe('Connection Management', () => {
    describe('connect', () => {
      it('should connect successfully', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);

        // When
        await driver.connect();

        // Then
        expect(driver.doConnectSpy).toHaveBeenCalledTimes(1);
        expect(driver.isConnected()).toBe(true);
      });

      it('should emit CONNECT and READY events on successful connection', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        const connectSpy = vi.fn();
        const readySpy = vi.fn();
        driver.on(DriverEvent.CONNECT, connectSpy);
        driver.on(DriverEvent.READY, readySpy);

        // When
        await driver.connect();

        // Then
        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(readySpy).toHaveBeenCalledTimes(1);
      });

      it('should emit ERROR event on connection failure', async () => {
        // Given
        const error = new Error('Connection failed');
        driver.doConnectSpy.mockRejectedValue(error);
        const errorSpy = vi.fn();
        driver.on(DriverEvent.ERROR, errorSpy);

        // When & Then
        await expect(driver.connect()).rejects.toThrow('Connection failed');
        expect(errorSpy).toHaveBeenCalledWith(error);
      });

      it('should skip connection if already connected', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        await driver.connect();
        driver.doConnectSpy.mockClear();

        // When
        await driver.connect();

        // Then
        expect(driver.doConnectSpy).not.toHaveBeenCalled();
      });

      it('should wait for ongoing connection', async () => {
        // Given
        driver.doConnectSpy.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

        // When
        const promise1 = driver.connect();
        const promise2 = driver.connect();

        // Then
        await expect(Promise.all([promise1, promise2])).resolves.toEqual([undefined, undefined]);
        expect(driver.doConnectSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('disconnect', () => {
      it('should disconnect successfully', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.doDisconnectSpy.mockResolvedValue(undefined);
        await driver.connect();

        // When
        await driver.disconnect();

        // Then
        expect(driver.doDisconnectSpy).toHaveBeenCalledTimes(1);
        expect(driver.isConnected()).toBe(false);
      });

      it('should emit DISCONNECT and CLOSE events on successful disconnection', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.doDisconnectSpy.mockResolvedValue(undefined);
        await driver.connect();
        const disconnectSpy = vi.fn();
        const closeSpy = vi.fn();
        driver.on(DriverEvent.DISCONNECT, disconnectSpy);
        driver.on(DriverEvent.CLOSE, closeSpy);

        // When
        await driver.disconnect();

        // Then
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        expect(closeSpy).toHaveBeenCalledTimes(1);
      });

      it('should skip disconnection if not connected', async () => {
        // When
        await driver.disconnect();

        // Then
        expect(driver.doDisconnectSpy).not.toHaveBeenCalled();
      });

      it('should emit ERROR event on disconnection failure', async () => {
        // Given
        const error = new Error('Disconnect failed');
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.doDisconnectSpy.mockRejectedValue(error);
        await driver.connect();
        const errorSpy = vi.fn();
        driver.on(DriverEvent.ERROR, errorSpy);

        // When & Then
        await expect(driver.disconnect()).rejects.toThrow('Disconnect failed');
        expect(errorSpy).toHaveBeenCalledWith(error);
      });
    });

    describe('isConnected', () => {
      it('should return false when not connected', () => {
        // When
        const result = driver.isConnected();

        // Then
        expect(result).toBe(false);
      });

      it('should return true when connected', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        await driver.connect();

        // When
        const result = driver.isConnected();

        // Then
        expect(result).toBe(true);
      });
    });

    describe('ping', () => {
      it('should ping Redis without message', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.executeCommandSpy.mockResolvedValue('PONG');
        await driver.connect();

        // When
        const result = await driver.ping();

        // Then
        expect(result).toBe('PONG');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PING');
      });

      it('should ping Redis with custom message', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.executeCommandSpy.mockResolvedValue('hello');
        await driver.connect();

        // When
        const result = await driver.ping('hello');

        // Then
        expect(result).toBe('hello');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PING', 'hello');
      });

      it('should throw error when not connected', async () => {
        // When & Then
        await expect(driver.ping()).rejects.toThrow('not connected');
      });
    });

    describe('select', () => {
      it('should select database', async () => {
        // Given
        driver.doConnectSpy.mockResolvedValue(undefined);
        driver.executeCommandSpy.mockResolvedValue('OK');
        await driver.connect();

        // When
        await driver.select(5);

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SELECT', 5);
      });
    });
  });

  describe('String Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('get', () => {
      it('should get value', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('value');

        // When
        const result = await driver.get('key');

        // Then
        expect(result).toBe('value');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GET', 'key');
      });

      it('should return null for non-existent key', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.get('key');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('set', () => {
      it('should set value without options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.set('key', 'value');

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SET', 'key', 'value');
      });

      it('should set value with EX option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.set('key', 'value', { ex: 60 });

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SET', 'key', 'value', 'EX', 60);
      });

      it('should set value with NX option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.set('key', 'value', { nx: true });

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SET', 'key', 'value', 'NX');
      });

      it('should set value with multiple options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.set('key', 'value', { ex: 60, nx: true });

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SET', 'key', 'value', 'EX', 60, 'NX');
      });
    });

    describe('mget', () => {
      it('should get multiple values', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['value1', 'value2', null]);

        // When
        const result = await driver.mget('key1', 'key2', 'key3');

        // Then
        expect(result).toEqual(['value1', 'value2', null]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('MGET', 'key1', 'key2', 'key3');
      });
    });

    describe('mset', () => {
      it('should set multiple values', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.mset({ key1: 'value1', key2: 'value2' });

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('MSET', 'key1', 'value1', 'key2', 'value2');
      });
    });

    describe('incr', () => {
      it('should increment value', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.incr('counter');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('INCR', 'counter');
      });
    });

    describe('decr', () => {
      it('should decrement value', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(-1);

        // When
        const result = await driver.decr('counter');

        // Then
        expect(result).toBe(-1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('DECR', 'counter');
      });
    });
  });

  describe('Key Management', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('del', () => {
      it('should delete single key', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.del('key');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('DEL', 'key');
      });

      it('should delete multiple keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(3);

        // When
        const result = await driver.del('key1', 'key2', 'key3');

        // Then
        expect(result).toBe(3);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('DEL', 'key1', 'key2', 'key3');
      });
    });

    describe('exists', () => {
      it('should check if keys exist', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.exists('key1', 'key2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EXISTS', 'key1', 'key2');
      });
    });

    describe('expire', () => {
      it('should set expiration', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.expire('key', 60);

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EXPIRE', 'key', 60);
      });
    });

    describe('ttl', () => {
      it('should get TTL', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(60);

        // When
        const result = await driver.ttl('key');

        // Then
        expect(result).toBe(60);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('TTL', 'key');
      });
    });

    describe('scan', () => {
      it('should scan keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['10', ['key1', 'key2']]);

        // When
        const result = await driver.scan(0);

        // Then
        expect(result).toEqual(['10', ['key1', 'key2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCAN', 0);
      });

      it('should scan keys with options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['key1']]);

        // When
        const result = await driver.scan(0, { match: 'key*', count: 100 });

        // Then
        expect(result).toEqual(['0', ['key1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCAN', 0, 'MATCH', 'key*', 'COUNT', 100);
      });
    });
  });

  describe('Hash Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('hget', () => {
      it('should get hash field', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('value');

        // When
        const result = await driver.hget('hash', 'field');

        // Then
        expect(result).toBe('value');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HGET', 'hash', 'field');
      });
    });

    describe('hset', () => {
      it('should set hash field', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.hset('hash', 'field', 'value');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSET', 'hash', 'field', 'value');
      });
    });

    describe('hgetall', () => {
      it('should get all hash fields', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue({ field1: 'value1', field2: 'value2' });

        // When
        const result = await driver.hgetall('hash');

        // Then
        expect(result).toEqual({ field1: 'value1', field2: 'value2' });
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HGETALL', 'hash');
      });
    });

    describe('hscan', () => {
      it('should scan hash', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['10', ['field1', 'value1', 'field2', 'value2']]);

        // When
        const result = await driver.hscan('hash', 0);

        // Then
        expect(result).toEqual(['10', ['field1', 'value1', 'field2', 'value2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSCAN', 'hash', 0);
      });

      it('should scan hash with match pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['field1', 'value1']]);

        // When
        const result = await driver.hscan('hash', 0, { match: 'field*' });

        // Then
        expect(result).toEqual(['0', ['field1', 'value1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSCAN', 'hash', 0, 'MATCH', 'field*');
      });

      it('should scan hash with count option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['20', ['field1', 'value1']]);

        // When
        const result = await driver.hscan('hash', 0, { count: 50 });

        // Then
        expect(result).toEqual(['20', ['field1', 'value1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSCAN', 'hash', 0, 'COUNT', 50);
      });

      it('should scan hash with both match and count options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['field1', 'value1']]);

        // When
        const result = await driver.hscan('hash', 0, { match: 'prefix*', count: 100 });

        // Then
        expect(result).toEqual(['0', ['field1', 'value1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSCAN', 'hash', 0, 'MATCH', 'prefix*', 'COUNT', 100);
      });
    });

    describe('hincrby', () => {
      it('should increment hash field by integer', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(15);

        // When
        const result = await driver.hincrby('hash', 'counter', 5);

        // Then
        expect(result).toBe(15);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HINCRBY', 'hash', 'counter', 5);
      });
    });

    describe('hvals', () => {
      it('should get all hash values', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['value1', 'value2', 'value3']);

        // When
        const result = await driver.hvals('hash');

        // Then
        expect(result).toEqual(['value1', 'value2', 'value3']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HVALS', 'hash');
      });
    });

    describe('hlen', () => {
      it('should get hash length', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(3);

        // When
        const result = await driver.hlen('hash');

        // Then
        expect(result).toBe(3);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HLEN', 'hash');
      });
    });

    describe('hexists', () => {
      it('should check if hash field exists', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.hexists('hash', 'field');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HEXISTS', 'hash', 'field');
      });

      it('should return 0 when field does not exist', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(0);

        // When
        const result = await driver.hexists('hash', 'nonexistent');

        // Then
        expect(result).toBe(0);
      });
    });

    describe('hkeys', () => {
      it('should get all hash keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['field1', 'field2', 'field3']);

        // When
        const result = await driver.hkeys('hash');

        // Then
        expect(result).toEqual(['field1', 'field2', 'field3']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HKEYS', 'hash');
      });
    });
  });

  describe('List Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('lpush', () => {
      it('should push to list', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.lpush('list', 'value1', 'value2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LPUSH', 'list', 'value1', 'value2');
      });
    });

    describe('lrange', () => {
      it('should get list range', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['value1', 'value2']);

        // When
        const result = await driver.lrange('list', 0, -1);

        // Then
        expect(result).toEqual(['value1', 'value2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LRANGE', 'list', 0, -1);
      });
    });

    describe('rpush', () => {
      it('should push to right of list', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.rpush('list', 'value1', 'value2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('RPUSH', 'list', 'value1', 'value2');
      });
    });

    describe('lpop', () => {
      it('should pop from left of list', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('value1');

        // When
        const result = await driver.lpop('list');

        // Then
        expect(result).toBe('value1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LPOP', 'list');
      });

      it('should return null when list is empty', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.lpop('list');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('rpop', () => {
      it('should pop from right of list', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('value1');

        // When
        const result = await driver.rpop('list');

        // Then
        expect(result).toBe('value1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('RPOP', 'list');
      });

      it('should return null when list is empty', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.rpop('list');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('llen', () => {
      it('should get list length', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.llen('list');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LLEN', 'list');
      });
    });

    describe('ltrim', () => {
      it('should trim list', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.ltrim('list', 0, 99);

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LTRIM', 'list', 0, 99);
      });
    });

    describe('lindex', () => {
      it('should get element at index', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('value1');

        // When
        const result = await driver.lindex('list', 0);

        // Then
        expect(result).toBe('value1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LINDEX', 'list', 0);
      });

      it('should return null for invalid index', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.lindex('list', 100);

        // Then
        expect(result).toBeNull();
      });
    });

    describe('lset', () => {
      it('should set element at index', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.lset('list', 0, 'newvalue');

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LSET', 'list', 0, 'newvalue');
      });
    });
  });

  describe('Set Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('sadd', () => {
      it('should add to set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.sadd('set', 'member1', 'member2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SADD', 'set', 'member1', 'member2');
      });
    });

    describe('smembers', () => {
      it('should get set members', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', 'member2']);

        // When
        const result = await driver.smembers('set');

        // Then
        expect(result).toEqual(['member1', 'member2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SMEMBERS', 'set');
      });
    });

    describe('sscan', () => {
      it('should scan set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['10', ['member1', 'member2']]);

        // When
        const result = await driver.sscan('set', 0);

        // Then
        expect(result).toEqual(['10', ['member1', 'member2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SSCAN', 'set', 0);
      });

      it('should scan set with match pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['member1']]);

        // When
        const result = await driver.sscan('set', 0, { match: 'member*' });

        // Then
        expect(result).toEqual(['0', ['member1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SSCAN', 'set', 0, 'MATCH', 'member*');
      });

      it('should scan set with count option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['20', ['member1', 'member2']]);

        // When
        const result = await driver.sscan('set', 0, { count: 50 });

        // Then
        expect(result).toEqual(['20', ['member1', 'member2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SSCAN', 'set', 0, 'COUNT', 50);
      });

      it('should scan set with both match and count options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['member1']]);

        // When
        const result = await driver.sscan('set', 0, { match: 'prefix*', count: 100 });

        // Then
        expect(result).toEqual(['0', ['member1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SSCAN', 'set', 0, 'MATCH', 'prefix*', 'COUNT', 100);
      });
    });

    describe('srem', () => {
      it('should remove members from set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.srem('set', 'member1', 'member2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SREM', 'set', 'member1', 'member2');
      });
    });

    describe('sismember', () => {
      it('should check if member exists in set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.sismember('set', 'member1');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SISMEMBER', 'set', 'member1');
      });

      it('should return 0 when member does not exist', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(0);

        // When
        const result = await driver.sismember('set', 'nonexistent');

        // Then
        expect(result).toBe(0);
      });
    });

    describe('scard', () => {
      it('should get set cardinality', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.scard('set');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCARD', 'set');
      });
    });

    describe('srandmember', () => {
      it('should get random member without count', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('member1');

        // When
        const result = await driver.srandmember('set');

        // Then
        expect(result).toBe('member1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SRANDMEMBER', 'set');
      });

      it('should get random members with count', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', 'member2']);

        // When
        const result = await driver.srandmember('set', 2);

        // Then
        expect(result).toEqual(['member1', 'member2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SRANDMEMBER', 'set', 2);
      });

      it('should return null for empty set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.srandmember('empty-set');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('spop', () => {
      it('should pop random member without count', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('member1');

        // When
        const result = await driver.spop('set');

        // Then
        expect(result).toBe('member1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SPOP', 'set');
      });

      it('should pop random members with count', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', 'member2']);

        // When
        const result = await driver.spop('set', 2);

        // Then
        expect(result).toEqual(['member1', 'member2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SPOP', 'set', 2);
      });

      it('should return null for empty set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.spop('empty-set');

        // Then
        expect(result).toBeNull();
      });
    });
  });

  describe('Sorted Set Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('zadd', () => {
      it('should add to sorted set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.zadd('zset', 1, 'member1');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZADD', 'zset', 1, 'member1');
      });
    });

    describe('zrem', () => {
      it('should remove members from sorted set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.zrem('zset', 'member1', 'member2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZREM', 'zset', 'member1', 'member2');
      });
    });

    describe('zscore', () => {
      it('should get member score', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('10.5');

        // When
        const result = await driver.zscore('zset', 'member1');

        // Then
        expect(result).toBe('10.5');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZSCORE', 'zset', 'member1');
      });

      it('should return null when member not found', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.zscore('zset', 'nonexistent');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('zcard', () => {
      it('should get sorted set cardinality', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.zcard('zset');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZCARD', 'zset');
      });

      it('should return 0 for empty set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(0);

        // When
        const result = await driver.zcard('emptyzset');

        // Then
        expect(result).toBe(0);
      });
    });

    describe('zrange', () => {
      it('should get range from sorted set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', 'member2']);

        // When
        const result = await driver.zrange('zset', 0, -1);

        // Then
        expect(result).toEqual(['member1', 'member2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANGE', 'zset', 0, -1);
      });

      it('should get range with scores', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', '1.5', 'member2', '2.5']);

        // When
        const result = await driver.zrange('zset', 0, -1, true);

        // Then
        expect(result).toEqual(['member1', '1.5', 'member2', '2.5']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANGE', 'zset', 0, -1, 'WITHSCORES');
      });
    });

    describe('zrangebyscore', () => {
      it('should get range by score', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', 'member2']);

        // When
        const result = await driver.zrangebyscore('zset', 0, 100);

        // Then
        expect(result).toEqual(['member1', 'member2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANGEBYSCORE', 'zset', 0, 100);
      });

      it('should get range by score with WITHSCORES', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1', '10', 'member2', '50']);

        // When
        const result = await driver.zrangebyscore('zset', 0, 100, true);

        // Then
        expect(result).toEqual(['member1', '10', 'member2', '50']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANGEBYSCORE', 'zset', 0, 100, 'WITHSCORES');
      });

      it('should support string min/max values', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member1']);

        // When
        const result = await driver.zrangebyscore('zset', '-inf', '+inf');

        // Then
        expect(result).toEqual(['member1']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANGEBYSCORE', 'zset', '-inf', '+inf');
      });
    });

    describe('zrank', () => {
      it('should get member rank', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.zrank('zset', 'member1');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANK', 'zset', 'member1');
      });

      it('should return null when member not found', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.zrank('zset', 'nonexistent');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('zincrby', () => {
      it('should increment member score', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('15.5');

        // When
        const result = await driver.zincrby('zset', 5.5, 'member1');

        // Then
        expect(result).toBe('15.5');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZINCRBY', 'zset', 5.5, 'member1');
      });

      it('should handle negative increments', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('5');

        // When
        const result = await driver.zincrby('zset', -5, 'member1');

        // Then
        expect(result).toBe('5');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZINCRBY', 'zset', -5, 'member1');
      });
    });

    describe('zscan', () => {
      it('should scan sorted set', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['10', ['member1', '1', 'member2', '2']]);

        // When
        const result = await driver.zscan('zset', 0);

        // Then
        expect(result).toEqual(['10', ['member1', '1', 'member2', '2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZSCAN', 'zset', 0);
      });

      it('should scan sorted set with match pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['member1', '1']]);

        // When
        const result = await driver.zscan('zset', 0, { match: 'member*' });

        // Then
        expect(result).toEqual(['0', ['member1', '1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZSCAN', 'zset', 0, 'MATCH', 'member*');
      });

      it('should scan sorted set with count option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['20', ['member1', '1', 'member2', '2']]);

        // When
        const result = await driver.zscan('zset', 0, { count: 50 });

        // Then
        expect(result).toEqual(['20', ['member1', '1', 'member2', '2']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZSCAN', 'zset', 0, 'COUNT', 50);
      });

      it('should scan sorted set with both match and count options', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['0', ['member1', '1']]);

        // When
        const result = await driver.zscan('zset', 0, { match: 'prefix*', count: 100 });

        // Then
        expect(result).toEqual(['0', ['member1', '1']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZSCAN', 'zset', 0, 'MATCH', 'prefix*', 'COUNT', 100);
      });
    });
  });

  describe('Pipeline and Multi', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('pipeline', () => {
      it('should create pipeline', () => {
        // When
        const pipeline = driver.pipeline();

        // Then
        expect(pipeline).toBe(driver.mockPipeline);
      });

      it('should throw error when not connected', async () => {
        // Given
        await driver.disconnect();

        // When & Then
        expect(() => driver.pipeline()).toThrow('not connected');
      });
    });

    describe('multi', () => {
      it('should create multi transaction', () => {
        // When
        const multi = driver.multi();

        // Then
        expect(multi).toBe(driver.mockMulti);
      });

      it('should throw error when not connected', async () => {
        // Given
        await driver.disconnect();

        // When & Then
        expect(() => driver.multi()).toThrow('not connected');
      });
    });
  });

  describe('Event Handling', () => {
    it('should register event handler with on', () => {
      // Given
      const handler = vi.fn();

      // When
      driver.on(DriverEvent.READY, handler);
      driver['emit'](DriverEvent.READY);

      // Then
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should register one-time handler with once', () => {
      // Given
      const handler = vi.fn();

      // When
      driver.once(DriverEvent.READY, handler);
      driver['emit'](DriverEvent.READY);
      driver['emit'](DriverEvent.READY);

      // Then
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should unregister handler with off', () => {
      // Given
      const handler = vi.fn();
      driver.on(DriverEvent.READY, handler);

      // When
      driver.off(DriverEvent.READY, handler);
      driver['emit'](DriverEvent.READY);

      // Then
      expect(handler).not.toHaveBeenCalled();
    });

    it('should remove all listeners for event', () => {
      // Given
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      driver.on(DriverEvent.READY, handler1);
      driver.on(DriverEvent.READY, handler2);

      // When
      driver.removeAllListeners(DriverEvent.READY);
      driver['emit'](DriverEvent.READY);

      // Then
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should remove all listeners for all events', () => {
      // Given
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      driver.on(DriverEvent.READY, handler1);
      driver.on(DriverEvent.ERROR, handler2);

      // When
      driver.removeAllListeners();

      // Verify listeners count
      const eventEmitter = driver['eventEmitter'];
      expect(eventEmitter.listenerCount(DriverEvent.READY)).toBe(0);
      expect(eventEmitter.listenerCount(DriverEvent.ERROR)).toBe(0);

      // Then
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Lua Scripts', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('eval', () => {
      it('should evaluate script', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('result');

        // When
        const result = await driver.eval('return ARGV[1]', [], ['hello']);

        // Then
        expect(result).toBe('result');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVAL', 'return ARGV[1]', 0, 'hello');
      });

      it('should evaluate script with keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('result');

        // When
        const result = await driver.eval('return redis.call("GET", KEYS[1])', ['mykey'], []);

        // Then
        expect(result).toBe('result');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVAL', 'return redis.call("GET", KEYS[1])', 1, 'mykey');
      });
    });

    describe('scriptLoad', () => {
      it('should load script', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('sha1');

        // When
        const result = await driver.scriptLoad('return ARGV[1]');

        // Then
        expect(result).toBe('sha1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCRIPT', 'LOAD', 'return ARGV[1]');
      });
    });

    describe('scriptExists', () => {
      it('should check if single script exists', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([1]);

        // When
        const result = await driver.scriptExists('sha1');

        // Then
        expect(result).toEqual([1]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCRIPT', 'EXISTS', 'sha1');
      });

      it('should check if multiple scripts exist', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([1, 0, 1]);

        // When
        const result = await driver.scriptExists('sha1', 'sha2', 'sha3');

        // Then
        expect(result).toEqual([1, 0, 1]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCRIPT', 'EXISTS', 'sha1', 'sha2', 'sha3');
      });
    });

    describe('scriptFlush', () => {
      it('should flush script cache', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.scriptFlush();

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCRIPT', 'FLUSH');
      });
    });

    describe('eval', () => {
      it('should execute Lua script', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(42);

        // When
        const result = await driver.eval('return 42', [], []);

        // Then
        expect(result).toBe(42);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVAL', 'return 42', 0);
      });

      it('should execute Lua script with keys and args', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['value1', 'value2']);

        // When
        const result = await driver.eval('return {KEYS[1], ARGV[1]}', ['key1'], ['arg1']);

        // Then
        expect(result).toEqual(['value1', 'value2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVAL', 'return {KEYS[1], ARGV[1]}', 1, 'key1', 'arg1');
      });
    });

    describe('evalsha', () => {
      it('should execute cached Lua script by SHA', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('result');

        // When
        const result = await driver.evalsha('abc123', [], []);

        // Then
        expect(result).toBe('result');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVALSHA', 'abc123', 0);
      });

      it('should execute cached Lua script with keys and args', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(123);

        // When
        const result = await driver.evalsha('def456', ['key1', 'key2'], [100, 'test']);

        // Then
        expect(result).toBe(123);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('EVALSHA', 'def456', 2, 'key1', 'key2', 100, 'test');
      });
    });
  });

  describe('Pub/Sub Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('publish', () => {
      it('should publish message to channel', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.publish('notifications', 'Hello World');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PUBLISH', 'notifications', 'Hello World');
      });
    });

    describe('subscribe', () => {
      it('should subscribe to single channel', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.subscribe('channel1');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SUBSCRIBE', 'channel1');
      });

      it('should subscribe to multiple channels', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.subscribe('channel1', 'channel2', 'channel3');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SUBSCRIBE', 'channel1', 'channel2', 'channel3');
      });
    });

    describe('unsubscribe', () => {
      it('should unsubscribe from single channel', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.unsubscribe('channel1');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('UNSUBSCRIBE', 'channel1');
      });

      it('should unsubscribe from multiple channels', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.unsubscribe('channel1', 'channel2');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('UNSUBSCRIBE', 'channel1', 'channel2');
      });
    });

    describe('psubscribe', () => {
      it('should subscribe to pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.psubscribe('news.*');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PSUBSCRIBE', 'news.*');
      });

      it('should subscribe to multiple patterns', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.psubscribe('news.*', 'alerts.*');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PSUBSCRIBE', 'news.*', 'alerts.*');
      });
    });

    describe('punsubscribe', () => {
      it('should unsubscribe from pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.punsubscribe('news.*');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PUNSUBSCRIBE', 'news.*');
      });

      it('should unsubscribe from multiple patterns', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(undefined);

        // When
        await driver.punsubscribe('news.*', 'alerts.*');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PUNSUBSCRIBE', 'news.*', 'alerts.*');
      });
    });
  });

  describe('Server Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('flushdb', () => {
      it('should flush database', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.flushdb();

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('FLUSHDB');
      });
    });

    describe('flushall', () => {
      it('should flush all databases', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.flushall();

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('FLUSHALL');
      });
    });

    describe('info', () => {
      it('should get server info', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('# Server\nredis_version:7.0.0');

        // When
        const result = await driver.info();

        // Then
        expect(result).toContain('redis_version');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('INFO');
      });

      it('should get specific info section', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('# Server\n');

        // When
        const result = await driver.info('server');

        // Then
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('INFO', 'server');
      });
    });

    describe('dbsize', () => {
      it('should get database size', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(42);

        // When
        const result = await driver.dbsize();

        // Then
        expect(result).toBe(42);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('DBSIZE');
      });
    });

    describe('cluster', () => {
      it('should execute CLUSTER command', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('cluster_state:ok');

        // When
        const result = await driver.cluster('INFO');

        // Then
        expect(result).toBe('cluster_state:ok');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('CLUSTER', 'INFO');
      });

      it('should execute CLUSTER command with multiple args', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.cluster('MEET', '127.0.0.1', 7000);

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('CLUSTER', 'MEET', '127.0.0.1', 7000);
      });

      it('should throw if not connected', async () => {
        // Given
        driver['connected'] = false;

        // When/Then
        await expect(driver.cluster('INFO')).rejects.toThrow();
      });
    });

    describe('sentinel', () => {
      it('should execute SENTINEL command', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([['name', 'mymaster']]);

        // When
        const result = await driver.sentinel('masters');

        // Then
        expect(result).toEqual([['name', 'mymaster']]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SENTINEL', 'masters');
      });

      it('should execute SENTINEL command with args', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['name', 'mymaster', 'ip', '127.0.0.1']);

        // When
        const result = await driver.sentinel('master', 'mymaster');

        // Then
        expect(result).toEqual(['name', 'mymaster', 'ip', '127.0.0.1']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SENTINEL', 'master', 'mymaster');
      });

      it('should throw if not connected', async () => {
        // Given
        driver['connected'] = false;

        // When/Then
        await expect(driver.sentinel('masters')).rejects.toThrow();
      });
    });
  });

  describe('Protected Utility Methods', () => {
    describe('log', () => {
      it('should log messages when logging enabled', () => {
        // Given
        const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
        const loggingDriver = new TestRedisDriver({
          type: 'single',
          host: 'localhost',
          port: 6379,
        });
        (loggingDriver as any).enableLogging = true;

        // When
        (loggingDriver as any).log('Test message');

        // Then
        expect(loggerDebugSpy).toHaveBeenCalledWith('Test message');
        loggerDebugSpy.mockRestore();
      });

      it('should log messages with data when logging enabled', () => {
        // Given
        const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
        const loggingDriver = new TestRedisDriver({
          type: 'single',
          host: 'localhost',
          port: 6379,
        });
        (loggingDriver as any).enableLogging = true;

        // When
        (loggingDriver as any).log('Test message', { foo: 'bar' });

        // Then
        expect(loggerDebugSpy).toHaveBeenCalledWith('Test message {"foo":"bar"}');
        loggerDebugSpy.mockRestore();
      });

      it('should not log when logging disabled', () => {
        // Given
        const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
        // driver has enableLogging: false by default

        // When
        (driver as any).log('Test message');

        // Then
        expect(loggerDebugSpy).not.toHaveBeenCalled();
        loggerDebugSpy.mockRestore();
      });
    });

    describe('withTimeout', () => {
      it('should resolve when promise completes before timeout', async () => {
        // Given
        const fastPromise = Promise.resolve('success');

        // When
        const result = await (driver as any).withTimeout(fastPromise, 1000, 'test-op');

        // Then
        expect(result).toBe('success');
      });

      it('should reject with TimeoutError when timeout exceeded', async () => {
        // Given
        const slowPromise = new Promise((resolve) => setTimeout(() => resolve('too late'), 1000));

        // When/Then
        await expect((driver as any).withTimeout(slowPromise, 50, 'slow-operation')).rejects.toThrow('slow-operation');
      });

      it('should include operation name in timeout error', async () => {
        // Given
        const slowPromise = new Promise((resolve) => setTimeout(() => resolve('result'), 1000));

        // When/Then
        try {
          await (driver as any).withTimeout(slowPromise, 10, 'critical-operation');
          throw new Error('Should have thrown');
        } catch (error: any) {
          expect(error.message).toContain('critical-operation');
        }
      });

      it('should preserve promise rejection', async () => {
        // Given
        const failingPromise = Promise.reject(new Error('Operation failed'));

        // When/Then
        await expect((driver as any).withTimeout(failingPromise, 1000, 'test-op')).rejects.toThrow('Operation failed');
      });
    });
  });

  describe('Connection Lifecycle Edge Cases', () => {
    it('should handle multiple connect attempts', async () => {
      // Given
      driver.doConnectSpy.mockResolvedValue(undefined);

      // When
      await driver.connect();
      const secondConnect = driver.connect();

      // Then - Second connect should not call doConnect again
      await expect(secondConnect).resolves.not.toThrow();
      expect(driver.doConnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle disconnect when not connected', async () => {
      // Given - driver is not connected

      // When/Then - Should not throw
      await expect(driver.disconnect()).resolves.not.toThrow();
      expect(driver.doDisconnectSpy).not.toHaveBeenCalled();
    });

    it('should reset connection state on disconnect', async () => {
      // Given
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();

      // When
      await driver.disconnect();

      // Then
      expect(driver.isConnected()).toBe(false);
    });

    it('should handle doConnect failures', async () => {
      // Given
      const error = new Error('Connection refused');
      driver.doConnectSpy.mockRejectedValue(error);

      // When/Then
      await expect(driver.connect()).rejects.toThrow('Connection refused');
      expect(driver.isConnected()).toBe(false);
    });

    it('should handle doDisconnect failures by throwing error', async () => {
      // Given
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();

      driver.doDisconnectSpy.mockRejectedValue(new Error('Disconnect failed'));

      // When/Then - Should throw the error
      await expect(driver.disconnect()).rejects.toThrow('Disconnect failed');
      // Connection state remains connected since disconnect failed
      expect(driver.isConnected()).toBe(true);
    });
  });

  describe('Event Emitter', () => {
    it('should emit connect event on successful connection', async () => {
      // Given
      const listener = vi.fn();
      driver.on(DriverEvent.CONNECT, listener);
      driver.doConnectSpy.mockResolvedValue(undefined);

      // When
      await driver.connect();

      // Then
      expect(listener).toHaveBeenCalled();
    });

    it('should support removeAllListeners for specific event', async () => {
      // Given
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      driver.on(DriverEvent.CONNECT, listener1);
      driver.on(DriverEvent.CONNECT, listener2);

      // When
      driver.removeAllListeners(DriverEvent.CONNECT);
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();

      // Then
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should support removeAllListeners for all events', async () => {
      // Given
      const connectListener = vi.fn();
      const disconnectListener = vi.fn();
      driver.on(DriverEvent.CONNECT, connectListener);
      driver.on(DriverEvent.DISCONNECT, disconnectListener);

      // When
      driver.removeAllListeners();
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
      await driver.disconnect();

      // Then
      expect(connectListener).not.toHaveBeenCalled();
      expect(disconnectListener).not.toHaveBeenCalled();
    });

    it('should support once for one-time listeners', async () => {
      // Given
      const listener = vi.fn();
      driver.once(DriverEvent.CONNECT, listener);
      driver.doConnectSpy.mockResolvedValue(undefined);

      // When
      await driver.connect();
      await driver.disconnect();
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();

      // Then - Should be called only once despite two connections
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support off to remove specific listener', async () => {
      // Given
      const listener = vi.fn();
      driver.on(DriverEvent.CONNECT, listener);
      driver.off(DriverEvent.CONNECT, listener);
      driver.doConnectSpy.mockResolvedValue(undefined);

      // When
      await driver.connect();

      // Then
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Command Execution with Connection Check', () => {
    it('should throw error when executing command without connection', async () => {
      // Given - driver is not connected

      // When/Then
      await expect(driver.get('key')).rejects.toThrow('Driver is not connected');
    });

    it('should allow command execution when connected', async () => {
      // Given
      driver.doConnectSpy.mockResolvedValue(undefined);
      driver.executeCommandSpy.mockResolvedValue('value');
      await driver.connect();

      // When
      const result = await driver.get('key');

      // Then
      expect(result).toBe('value');
    });
  });

  describe('Constructor Options', () => {
    it('should accept enableLogging option', () => {
      // When
      const loggingDriver = new TestRedisDriver({
        type: 'single',
        host: 'localhost',
        port: 6379,
      });

      // Then
      expect((loggingDriver as any).enableLogging).toBe(false);
    });

    it('should enable logging when option is true', () => {
      // When
      class LoggingTestDriver extends TestRedisDriver {
        constructor(config: ConnectionConfig) {
          super(config);
          (this as any).enableLogging = true;
        }
      }

      const loggingDriver = new LoggingTestDriver({
        type: 'single',
        host: 'localhost',
        port: 6379,
      });

      // Then
      expect((loggingDriver as any).enableLogging).toBe(true);
    });
  });

  describe('Additional Command Coverage', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    it('should handle getex command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue('value');

      // When
      const result = await driver.getex('key', { ex: 60 });

      // Then
      expect(result).toBe('value');
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('GETEX', 'key', 'EX', 60);
    });

    it('should handle pexpire command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(1);

      // When
      const result = await driver.pexpire('key', 60000);

      // Then
      expect(result).toBe(1);
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('PEXPIRE', 'key', 60000);
    });

    it('should handle expireat command', async () => {
      // Given
      const timestamp = Math.floor(Date.now() / 1000) + 3600;
      driver.executeCommandSpy.mockResolvedValue(1);

      // When
      const result = await driver.expireat('key', timestamp);

      // Then
      expect(result).toBe(1);
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('EXPIREAT', 'key', timestamp);
    });

    it('should handle pttl command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(60000);

      // When
      const result = await driver.pttl('key');

      // Then
      expect(result).toBe(60000);
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('PTTL', 'key');
    });

    it('should handle persist command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(1);

      // When
      const result = await driver.persist('key');

      // Then
      expect(result).toBe(1);
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('PERSIST', 'key');
    });

    it('should handle type command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue('string');

      // When
      const result = await driver.type('key');

      // Then
      expect(result).toBe('string');
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('TYPE', 'key');
    });

    it('should handle hscan command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(['0', ['field1', 'value1']]);

      // When
      const result = await driver.hscan('hash', '0', { match: 'field*', count: 10 });

      // Then
      expect(result).toEqual(['0', ['field1', 'value1']]);
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSCAN', 'hash', '0', 'MATCH', 'field*', 'COUNT', 10);
    });

    it('should handle sscan command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(['0', ['member1', 'member2']]);

      // When
      const result = await driver.sscan('set', '0', { match: 'member*' });

      // Then
      expect(result).toEqual(['0', ['member1', 'member2']]);
    });

    it('should handle zscan command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(['0', ['member1', '1', 'member2', '2']]);

      // When
      const result = await driver.zscan('zset', '0');

      // Then
      expect(result).toEqual(['0', ['member1', '1', 'member2', '2']]);
    });

    it('should handle psubscribe command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(undefined);

      // When
      await driver.psubscribe('channel:*', 'user:*');

      // Then
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('PSUBSCRIBE', 'channel:*', 'user:*');
    });

    it('should handle punsubscribe command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue(undefined);

      // When
      await driver.punsubscribe('channel:*');

      // Then
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('PUNSUBSCRIBE', 'channel:*');
    });

    it('should handle scriptFlush command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue('OK');

      // When
      const result = await driver.scriptFlush();

      // Then
      expect(result).toBe('OK');
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('SCRIPT', 'FLUSH');
    });

    it('should handle select command', async () => {
      // Given
      driver.executeCommandSpy.mockResolvedValue('OK');

      // When
      await driver.select(5);

      // Then
      expect(driver.executeCommandSpy).toHaveBeenCalledWith('SELECT', 5);
    });
  });

  describe('New String Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('strlen', () => {
      it('should get string length', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(11);

        // When
        const result = await driver.strlen('key');

        // Then
        expect(result).toBe(11);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('STRLEN', 'key');
      });
    });

    describe('incrbyfloat', () => {
      it('should increment by float', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('10.5');

        // When
        const result = await driver.incrbyfloat('counter', 0.5);

        // Then
        expect(result).toBe('10.5');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('INCRBYFLOAT', 'counter', 0.5);
      });
    });

    describe('getrange', () => {
      it('should get substring', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('Hello');

        // When
        const result = await driver.getrange('key', 0, 4);

        // Then
        expect(result).toBe('Hello');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GETRANGE', 'key', 0, 4);
      });
    });

    describe('setrange', () => {
      it('should overwrite at offset', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(11);

        // When
        const result = await driver.setrange('key', 6, 'Redis');

        // Then
        expect(result).toBe(11);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SETRANGE', 'key', 6, 'Redis');
      });
    });

    describe('msetnx', () => {
      it('should set multiple if none exist', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.msetnx({ key1: 'value1', key2: 'value2' });

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('MSETNX', 'key1', 'value1', 'key2', 'value2');
      });
    });
  });

  describe('New Key Management Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('unlink', () => {
      it('should async delete keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(3);

        // When
        const result = await driver.unlink('key1', 'key2', 'key3');

        // Then
        expect(result).toBe(3);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('UNLINK', 'key1', 'key2', 'key3');
      });
    });

    describe('copy', () => {
      it('should copy key', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.copy('source', 'dest');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('COPY', 'source', 'dest');
      });

      it('should copy with replace option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.copy('source', 'dest', { replace: true });

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('COPY', 'source', 'dest', 'REPLACE');
      });

      it('should copy to different db', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.copy('source', 'dest', { db: 5 });

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('COPY', 'source', 'dest', 'DB', 5);
      });
    });

    describe('keys', () => {
      it('should find keys matching pattern', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['key1', 'key2', 'key3']);

        // When
        const result = await driver.keys('key*');

        // Then
        expect(result).toEqual(['key1', 'key2', 'key3']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('KEYS', 'key*');
      });
    });

    describe('touch', () => {
      it('should touch keys', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.touch('key1', 'key2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('TOUCH', 'key1', 'key2');
      });
    });

    describe('object', () => {
      it('should get encoding', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('embstr');

        // When
        const result = await driver.object('ENCODING', 'key');

        // Then
        expect(result).toBe('embstr');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('OBJECT', 'ENCODING', 'key');
      });

      it('should get idletime', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(10);

        // When
        const result = await driver.object('IDLETIME', 'key');

        // Then
        expect(result).toBe(10);
      });
    });

    describe('time', () => {
      it('should get server time', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['1234567890', '123456']);

        // When
        const result = await driver.time();

        // Then
        expect(result).toEqual(['1234567890', '123456']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('TIME');
      });
    });
  });

  describe('New Hash Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('hsetnx', () => {
      it('should set field if not exists', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.hsetnx('hash', 'field', 'value');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSETNX', 'hash', 'field', 'value');
      });
    });

    describe('hincrbyfloat', () => {
      it('should increment hash field by float', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('10.5');

        // When
        const result = await driver.hincrbyfloat('hash', 'field', 0.5);

        // Then
        expect(result).toBe('10.5');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HINCRBYFLOAT', 'hash', 'field', 0.5);
      });
    });

    describe('hstrlen', () => {
      it('should get field value length', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.hstrlen('hash', 'field');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HSTRLEN', 'hash', 'field');
      });
    });

    describe('hrandfield', () => {
      it('should get random field', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('field1');

        // When
        const result = await driver.hrandfield('hash');

        // Then
        expect(result).toBe('field1');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HRANDFIELD', 'hash');
      });

      it('should get multiple random fields', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['field1', 'field2']);

        // When
        const result = await driver.hrandfield('hash', 2);

        // Then
        expect(result).toEqual(['field1', 'field2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HRANDFIELD', 'hash', 2);
      });

      it('should get random fields with values', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['field1', 'value1', 'field2', 'value2']);

        // When
        const result = await driver.hrandfield('hash', 2, true);

        // Then
        expect(result).toEqual(['field1', 'value1', 'field2', 'value2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('HRANDFIELD', 'hash', 2, 'WITHVALUES');
      });
    });
  });

  describe('New List Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('linsert', () => {
      it('should insert before pivot', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(4);

        // When
        const result = await driver.linsert('list', 'BEFORE', 'pivot', 'value');

        // Then
        expect(result).toBe(4);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LINSERT', 'list', 'BEFORE', 'pivot', 'value');
      });

      it('should insert after pivot', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(4);

        // When
        const result = await driver.linsert('list', 'AFTER', 'pivot', 'value');

        // Then
        expect(result).toBe(4);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LINSERT', 'list', 'AFTER', 'pivot', 'value');
      });
    });

    describe('lrem', () => {
      it('should remove elements', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.lrem('list', 2, 'value');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LREM', 'list', 2, 'value');
      });
    });

    describe('lpos', () => {
      it('should get element position', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.lpos('list', 'element');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LPOS', 'list', 'element');
      });

      it('should get multiple positions with COUNT', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([0, 2, 4]);

        // When
        const result = await driver.lpos('list', 'element', { count: 3 });

        // Then
        expect(result).toEqual([0, 2, 4]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LPOS', 'list', 'element', 'COUNT', 3);
      });
    });

    describe('blpop', () => {
      it('should blocking left pop', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['list', 'value']);

        // When
        const result = await driver.blpop(['list1', 'list2'], 5);

        // Then
        expect(result).toEqual(['list', 'value']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BLPOP', 'list1', 'list2', 5);
      });

      it('should return null on timeout', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.blpop(['list'], 1);

        // Then
        expect(result).toBeNull();
      });
    });

    describe('brpop', () => {
      it('should blocking right pop', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['list', 'value']);

        // When
        const result = await driver.brpop(['list'], 5);

        // Then
        expect(result).toEqual(['list', 'value']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BRPOP', 'list', 5);
      });
    });

    describe('lmove', () => {
      it('should move element between lists', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('element');

        // When
        const result = await driver.lmove('src', 'dest', 'LEFT', 'RIGHT');

        // Then
        expect(result).toBe('element');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('LMOVE', 'src', 'dest', 'LEFT', 'RIGHT');
      });
    });

    describe('blmove', () => {
      it('should blocking move element', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('element');

        // When
        const result = await driver.blmove('src', 'dest', 'RIGHT', 'LEFT', 5);

        // Then
        expect(result).toBe('element');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BLMOVE', 'src', 'dest', 'RIGHT', 'LEFT', 5);
      });
    });
  });

  describe('New Set Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('smove', () => {
      it('should move member between sets', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.smove('src', 'dest', 'member');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SMOVE', 'src', 'dest', 'member');
      });
    });

    describe('sinter', () => {
      it('should get intersection', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['common1', 'common2']);

        // When
        const result = await driver.sinter('set1', 'set2');

        // Then
        expect(result).toEqual(['common1', 'common2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SINTER', 'set1', 'set2');
      });
    });

    describe('sinterstore', () => {
      it('should store intersection', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.sinterstore('dest', 'set1', 'set2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SINTERSTORE', 'dest', 'set1', 'set2');
      });
    });

    describe('sunion', () => {
      it('should get union', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['a', 'b', 'c', 'd']);

        // When
        const result = await driver.sunion('set1', 'set2');

        // Then
        expect(result).toEqual(['a', 'b', 'c', 'd']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SUNION', 'set1', 'set2');
      });
    });

    describe('sunionstore', () => {
      it('should store union', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(4);

        // When
        const result = await driver.sunionstore('dest', 'set1', 'set2');

        // Then
        expect(result).toBe(4);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SUNIONSTORE', 'dest', 'set1', 'set2');
      });
    });

    describe('sdiff', () => {
      it('should get difference', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['a', 'b']);

        // When
        const result = await driver.sdiff('set1', 'set2');

        // Then
        expect(result).toEqual(['a', 'b']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SDIFF', 'set1', 'set2');
      });
    });

    describe('sdiffstore', () => {
      it('should store difference', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.sdiffstore('dest', 'set1', 'set2');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SDIFFSTORE', 'dest', 'set1', 'set2');
      });
    });

    describe('smismember', () => {
      it('should check multiple members', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([1, 0, 1]);

        // When
        const result = await driver.smismember('set', 'a', 'b', 'c');

        // Then
        expect(result).toEqual([1, 0, 1]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SMISMEMBER', 'set', 'a', 'b', 'c');
      });
    });
  });

  describe('New Sorted Set Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('zrevrank', () => {
      it('should get reverse rank', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.zrevrank('zset', 'member');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZREVRANK', 'zset', 'member');
      });

      it('should return null if member not found', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.zrevrank('zset', 'nonexistent');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('zcount', () => {
      it('should count members in score range', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.zcount('zset', 10, 50);

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZCOUNT', 'zset', 10, 50);
      });

      it('should support string min/max', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(10);

        // When
        const result = await driver.zcount('zset', '-inf', '+inf');

        // Then
        expect(result).toBe(10);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZCOUNT', 'zset', '-inf', '+inf');
      });
    });

    describe('zlexcount', () => {
      it('should count in lexical range', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(3);

        // When
        const result = await driver.zlexcount('zset', '[a', '[d');

        // Then
        expect(result).toBe(3);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZLEXCOUNT', 'zset', '[a', '[d');
      });
    });

    describe('zpopmin', () => {
      it('should pop min element', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member', '1']);

        // When
        const result = await driver.zpopmin('zset');

        // Then
        expect(result).toEqual(['member', '1']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZPOPMIN', 'zset');
      });

      it('should pop multiple min elements', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m1', '1', 'm2', '2']);

        // When
        const result = await driver.zpopmin('zset', 2);

        // Then
        expect(result).toEqual(['m1', '1', 'm2', '2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZPOPMIN', 'zset', 2);
      });
    });

    describe('zpopmax', () => {
      it('should pop max element', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['member', '100']);

        // When
        const result = await driver.zpopmax('zset');

        // Then
        expect(result).toEqual(['member', '100']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZPOPMAX', 'zset');
      });
    });

    describe('bzpopmin', () => {
      it('should blocking pop min', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['zset', 'member', '1']);

        // When
        const result = await driver.bzpopmin(['zset1', 'zset2'], 5);

        // Then
        expect(result).toEqual(['zset', 'member', '1']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BZPOPMIN', 'zset1', 'zset2', 5);
      });

      it('should return null on timeout', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.bzpopmin(['zset'], 1);

        // Then
        expect(result).toBeNull();
      });
    });

    describe('bzpopmax', () => {
      it('should blocking pop max', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['zset', 'member', '100']);

        // When
        const result = await driver.bzpopmax(['zset'], 5);

        // Then
        expect(result).toEqual(['zset', 'member', '100']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BZPOPMAX', 'zset', 5);
      });
    });

    describe('zunionstore', () => {
      it('should store union', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.zunionstore('dest', ['zset1', 'zset2']);

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZUNIONSTORE', 'dest', 2, 'zset1', 'zset2');
      });

      it('should store union with weights', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.zunionstore('dest', ['zset1', 'zset2'], { weights: [1, 2] });

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZUNIONSTORE', 'dest', 2, 'zset1', 'zset2', 'WEIGHTS', 1, 2);
      });

      it('should store union with aggregate', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.zunionstore('dest', ['zset1', 'zset2'], { aggregate: 'MAX' });

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZUNIONSTORE', 'dest', 2, 'zset1', 'zset2', 'AGGREGATE', 'MAX');
      });
    });

    describe('zinterstore', () => {
      it('should store intersection', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.zinterstore('dest', ['zset1', 'zset2']);

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZINTERSTORE', 'dest', 2, 'zset1', 'zset2');
      });
    });

    describe('zmscore', () => {
      it('should get multiple scores', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['10', null, '30']);

        // When
        const result = await driver.zmscore('zset', 'a', 'b', 'c');

        // Then
        expect(result).toEqual(['10', null, '30']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZMSCORE', 'zset', 'a', 'b', 'c');
      });
    });

    describe('zrandmember', () => {
      it('should get random member', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('member');

        // When
        const result = await driver.zrandmember('zset');

        // Then
        expect(result).toBe('member');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANDMEMBER', 'zset');
      });

      it('should get random members with count', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m1', 'm2']);

        // When
        const result = await driver.zrandmember('zset', 2);

        // Then
        expect(result).toEqual(['m1', 'm2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANDMEMBER', 'zset', 2);
      });

      it('should get random members with scores', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m1', '1', 'm2', '2']);

        // When
        const result = await driver.zrandmember('zset', 2, true);

        // Then
        expect(result).toEqual(['m1', '1', 'm2', '2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZRANDMEMBER', 'zset', 2, 'WITHSCORES');
      });
    });

    describe('zrevrangebyscore', () => {
      it('should get reverse range by score', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m2', 'm1']);

        // When
        const result = await driver.zrevrangebyscore('zset', 100, 0);

        // Then
        expect(result).toEqual(['m2', 'm1']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZREVRANGEBYSCORE', 'zset', 100, 0);
      });

      it('should support withScores option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m2', '50', 'm1', '10']);

        // When
        const result = await driver.zrevrangebyscore('zset', 100, 0, { withScores: true });

        // Then
        expect(result).toEqual(['m2', '50', 'm1', '10']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZREVRANGEBYSCORE', 'zset', 100, 0, 'WITHSCORES');
      });

      it('should support limit option', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['m2']);

        // When
        const result = await driver.zrevrangebyscore('zset', 100, 0, { limit: { offset: 0, count: 1 } });

        // Then
        expect(result).toEqual(['m2']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('ZREVRANGEBYSCORE', 'zset', 100, 0, 'LIMIT', 0, 1);
      });
    });
  });

  describe('HyperLogLog Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('pfadd', () => {
      it('should add elements', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.pfadd('hll', 'a', 'b', 'c');

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PFADD', 'hll', 'a', 'b', 'c');
      });
    });

    describe('pfcount', () => {
      it('should count unique elements', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(100);

        // When
        const result = await driver.pfcount('hll1', 'hll2');

        // Then
        expect(result).toBe(100);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PFCOUNT', 'hll1', 'hll2');
      });
    });

    describe('pfmerge', () => {
      it('should merge HLLs', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('OK');

        // When
        const result = await driver.pfmerge('dest', 'hll1', 'hll2');

        // Then
        expect(result).toBe('OK');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('PFMERGE', 'dest', 'hll1', 'hll2');
      });
    });
  });

  describe('Geo Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('geoadd', () => {
      it('should add geo points', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.geoadd('geo', -122.4194, 37.7749, 'sf', -73.9352, 40.7304, 'nyc');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEOADD', 'geo', -122.4194, 37.7749, 'sf', -73.9352, 40.7304, 'nyc');
      });
    });

    describe('geodist', () => {
      it('should get distance', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue('4129.5212');

        // When
        const result = await driver.geodist('geo', 'sf', 'nyc', 'km');

        // Then
        expect(result).toBe('4129.5212');
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEODIST', 'geo', 'sf', 'nyc', 'km');
      });

      it('should return null if member not found', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await driver.geodist('geo', 'sf', 'unknown');

        // Then
        expect(result).toBeNull();
      });
    });

    describe('geohash', () => {
      it('should get geohashes', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['9q8yy9b', null, '9q8yy9c']);

        // When
        const result = await driver.geohash('geo', 'sf', 'unknown', 'nyc');

        // Then
        expect(result).toEqual(['9q8yy9b', null, '9q8yy9c']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEOHASH', 'geo', 'sf', 'unknown', 'nyc');
      });
    });

    describe('geopos', () => {
      it('should get positions', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue([['-122.4194', '37.7749'], null]);

        // When
        const result = await driver.geopos('geo', 'sf', 'unknown');

        // Then
        expect(result).toEqual([['-122.4194', '37.7749'], null]);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEOPOS', 'geo', 'sf', 'unknown');
      });
    });

    describe('geosearch', () => {
      it('should search by member and radius', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['sf', 'oakland']);

        // When
        const result = await driver.geosearch('geo', {
          member: 'sf',
          radius: { value: 100, unit: 'km' },
        });

        // Then
        expect(result).toEqual(['sf', 'oakland']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEOSEARCH', 'geo', 'FROMMEMBER', 'sf', 'BYRADIUS', 100, 'km');
      });

      it('should search by coordinates and box', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(['sf']);

        // When
        const result = await driver.geosearch('geo', {
          coord: { longitude: -122.4194, latitude: 37.7749 },
          box: { width: 100, height: 100, unit: 'km' },
          sort: 'ASC',
          count: 5,
        });

        // Then
        expect(result).toEqual(['sf']);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GEOSEARCH', 'geo', 'FROMLONLAT', -122.4194, 37.7749, 'BYBOX', 100, 100, 'km', 'ASC', 'COUNT', 5);
      });
    });
  });

  describe('Bitmap Commands', () => {
    beforeEach(async () => {
      driver.doConnectSpy.mockResolvedValue(undefined);
      await driver.connect();
    });

    describe('setbit', () => {
      it('should set bit', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(0);

        // When
        const result = await driver.setbit('bitmap', 7, 1);

        // Then
        expect(result).toBe(0);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('SETBIT', 'bitmap', 7, 1);
      });
    });

    describe('getbit', () => {
      it('should get bit', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(1);

        // When
        const result = await driver.getbit('bitmap', 7);

        // Then
        expect(result).toBe(1);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('GETBIT', 'bitmap', 7);
      });
    });

    describe('bitcount', () => {
      it('should count bits', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(5);

        // When
        const result = await driver.bitcount('bitmap');

        // Then
        expect(result).toBe(5);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITCOUNT', 'bitmap');
      });

      it('should count bits in range', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(3);

        // When
        const result = await driver.bitcount('bitmap', 0, 10);

        // Then
        expect(result).toBe(3);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITCOUNT', 'bitmap', 0, 10);
      });

      it('should count bits with BIT mode', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(2);

        // When
        const result = await driver.bitcount('bitmap', 0, 63, 'BIT');

        // Then
        expect(result).toBe(2);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITCOUNT', 'bitmap', 0, 63, 'BIT');
      });
    });

    describe('bitop', () => {
      it('should perform AND operation', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(10);

        // When
        const result = await driver.bitop('AND', 'dest', 'key1', 'key2');

        // Then
        expect(result).toBe(10);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITOP', 'AND', 'dest', 'key1', 'key2');
      });

      it('should perform NOT operation', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(10);

        // When
        const result = await driver.bitop('NOT', 'dest', 'key1');

        // Then
        expect(result).toBe(10);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITOP', 'NOT', 'dest', 'key1');
      });
    });

    describe('bitpos', () => {
      it('should find first bit', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(7);

        // When
        const result = await driver.bitpos('bitmap', 1);

        // Then
        expect(result).toBe(7);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITPOS', 'bitmap', 1);
      });

      it('should find first bit in range', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(15);

        // When
        const result = await driver.bitpos('bitmap', 1, 1, 10);

        // Then
        expect(result).toBe(15);
        expect(driver.executeCommandSpy).toHaveBeenCalledWith('BITPOS', 'bitmap', 1, 1, 10);
      });

      it('should return -1 when not found', async () => {
        // Given
        driver.executeCommandSpy.mockResolvedValue(-1);

        // When
        const result = await driver.bitpos('bitmap', 0);

        // Then
        expect(result).toBe(-1);
      });
    });
  });
});
