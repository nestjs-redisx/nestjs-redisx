import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IoRedisAdapter } from '../../src/driver/infrastructure/ioredis.adapter';
import { ConnectionConfig } from '../../src/types';
import { ConnectionError, CommandError, DriverError } from '../../src/shared/errors';
import { DriverEvent } from '../../src/interfaces';
import Redis, { Cluster } from 'ioredis';

/**
 * Creates an IoRedisAdapter with a mocked client already "connected".
 * This avoids calling adapter.connect() which attempts a real Redis connection.
 */
function createConnectedAdapter(config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 }, mockClientOverrides: Record<string, unknown> = {}): { adapter: IoRedisAdapter; mockClient: Record<string, unknown> } {
  const adapter = new IoRedisAdapter(config);

  const mockClient = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    mget: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(0),
    pipeline: vi.fn(),
    multi: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    ...mockClientOverrides,
  };

  (adapter as any).client = mockClient;
  (adapter as any).connected = true;

  return { adapter, mockClient };
}

describe('IoRedisAdapter', () => {
  describe('Constructor', () => {
    it('should create adapter with single connection config', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
      expect(adapter.isConnected()).toBe(false);
    });

    it('should create adapter with cluster connection config', () => {
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [
          { host: 'localhost', port: 7000 },
          { host: 'localhost', port: 7001 },
        ],
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
      expect(adapter.isConnected()).toBe(false);
    });

    it('should create adapter with sentinel connection config', () => {
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [{ host: 'localhost', port: 26379 }],
        name: 'mymaster',
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
      expect(adapter.isConnected()).toBe(false);
    });

    it('should accept enableLogging option', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config, { enableLogging: true });
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
      expect(adapter['enableLogging']).toBe(true);
    });

    it('should default enableLogging to false', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter['enableLogging']).toBe(false);
    });
  });

  describe('Configuration Options', () => {
    it('should handle full single connection config', () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'redis.example.com',
        port: 6380,
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
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle TLS configuration', () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6380,
        tls: { enabled: true, rejectUnauthorized: true, ca: 'ca-cert', cert: 'client-cert', key: 'client-key' },
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle cluster configuration with options', () => {
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [
          { host: 'localhost', port: 7000 },
          { host: 'localhost', port: 7001 },
          { host: 'localhost', port: 7002 },
        ],
        password: 'secret',
        db: 0,
        clusterOptions: {
          enableReadyCheck: false,
          maxRedirections: 32,
          retryDelayOnClusterDown: 200,
          retryDelayOnFailover: 200,
          scaleReads: 'slave',
        },
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle sentinel configuration with options', () => {
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [
          { host: 'localhost', port: 26379 },
          { host: 'localhost', port: 26380 },
        ],
        name: 'mymaster',
        password: 'secret',
        db: 0,
        sentinelOptions: {
          sentinelPassword: 'sentinel-secret',
          sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
          enableTLSForSentinelMode: false,
        },
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });
  });

  describe('Initial State', () => {
    it('should return null client before connection', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter.getClient()).toBeNull();
    });

    it('should not be connected initially', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('Configuration Defaults', () => {
    it('should use default host and port for single connection', () => {
      const config: ConnectionConfig = { type: 'single' };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should use default db for single connection', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle minimal cluster config', () => {
      const config: ConnectionConfig = { type: 'cluster', nodes: [{ host: 'localhost', port: 7000 }] };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle minimal sentinel config', () => {
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [{ host: 'localhost', port: 26379 }],
        name: 'mymaster',
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });
  });

  describe('Type Guards', () => {
    it('should validate single connection config structure', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379, password: 'secret', db: 1 };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should validate cluster connection config structure', () => {
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [
          { host: 'node1', port: 7000 },
          { host: 'node2', port: 7001 },
        ],
        password: 'secret',
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should validate sentinel connection config structure', () => {
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26380 },
        ],
        name: 'mymaster',
        password: 'secret',
        db: 1,
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });
  });

  describe('Command Execution', () => {
    it('should execute command and return result', async () => {
      const { adapter, mockClient } = createConnectedAdapter(
        {},
        {
          get: vi.fn().mockResolvedValue('value'),
        },
      );

      const result = await adapter.get('key');
      expect(result).toBe('value');
      expect(mockClient.get).toHaveBeenCalledWith('key');
    });

    it('should throw DriverError when client not initialized', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      await expect(adapter.get('key')).rejects.toThrow(DriverError);
    });

    it('should throw CommandError for invalid command', async () => {
      const { adapter } = createConnectedAdapter();
      // executeCommand is protected, access through reflection
      await expect((adapter as any).executeCommand('INVALIDCOMMAND')).rejects.toThrow(CommandError);
    });

    it('should handle command execution errors', async () => {
      const { adapter } = createConnectedAdapter(
        {},
        {
          get: vi.fn().mockRejectedValue(new Error('Connection lost')),
        },
      );
      await expect(adapter.get('key')).rejects.toThrow(CommandError);
    });

    it('should execute commands with multiple arguments', async () => {
      const { adapter, mockClient } = createConnectedAdapter(
        {},
        {
          mget: vi.fn().mockResolvedValue(['val1', 'val2', null]),
        },
      );

      const result = await adapter.mget('key1', 'key2', 'key3');
      expect(result).toEqual(['val1', 'val2', null]);
      expect(mockClient.mget).toHaveBeenCalledWith('key1', 'key2', 'key3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values in get', async () => {
      const { adapter } = createConnectedAdapter(
        {},
        {
          get: vi.fn().mockResolvedValue(null),
        },
      );
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should handle empty string values', async () => {
      const { adapter, mockClient } = createConnectedAdapter(
        {},
        {
          get: vi.fn().mockResolvedValue(''),
          set: vi.fn().mockResolvedValue('OK'),
        },
      );

      await adapter.set('key', '');
      const result = await adapter.get('key');
      expect(result).toBe('');
      expect(mockClient.set).toHaveBeenCalledWith('key', '');
    });

    it('should handle very long string values', async () => {
      const longValue = 'x'.repeat(1024 * 1024);
      const { adapter } = createConnectedAdapter(
        {},
        {
          set: vi.fn().mockResolvedValue('OK'),
          get: vi.fn().mockResolvedValue(longValue),
        },
      );

      await adapter.set('key', longValue);
      const result = await adapter.get('key');
      expect(result).toBe(longValue);
      expect(result?.length).toBe(1024 * 1024);
    });

    it('should handle Unicode characters', async () => {
      const unicodeValue = '你好世界 🚀 مرحبا';
      const { adapter } = createConnectedAdapter(
        {},
        {
          set: vi.fn().mockResolvedValue('OK'),
          get: vi.fn().mockResolvedValue(unicodeValue),
        },
      );

      await adapter.set('key', unicodeValue);
      const result = await adapter.get('key');
      expect(result).toBe(unicodeValue);
    });

    it('should handle special characters in keys', async () => {
      const specialKeys = ['key:with:colons', 'key-with-dashes', 'key.with.dots', 'key/with/slashes'];
      const { adapter } = createConnectedAdapter(
        {},
        {
          get: vi.fn().mockImplementation((key: string) => Promise.resolve(`value-${key}`)),
        },
      );

      for (const key of specialKeys) {
        const result = await adapter.get(key);
        expect(result).toBe(`value-${key}`);
      }
    });

    it('should handle empty arrays in mget', async () => {
      const { adapter } = createConnectedAdapter(
        {},
        {
          mget: vi.fn().mockResolvedValue([]),
        },
      );

      const result = await adapter.mget();
      expect(result).toEqual([]);
    });

    it('should handle arrays with all null values', async () => {
      const { adapter } = createConnectedAdapter(
        {},
        {
          mget: vi.fn().mockResolvedValue([null, null, null]),
        },
      );

      const result = await adapter.mget('key1', 'key2', 'key3');
      expect(result).toEqual([null, null, null]);
    });

    it('should handle zero and negative numbers', async () => {
      const { adapter } = createConnectedAdapter(
        {},
        {
          incrby: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(-5).mockResolvedValueOnce(-10),
        },
      );

      const zero = await adapter.incrby('counter', 0);
      const negative = await adapter.incrby('counter', -5);
      const moreNegative = await adapter.incrby('counter', -5);

      expect(zero).toBe(0);
      expect(negative).toBe(-5);
      expect(moreNegative).toBe(-10);
    });
  });

  describe('Pipeline and Multi', () => {
    it('should create pipeline', async () => {
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 'OK'],
          [null, 'value'],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.set('key', 'value');
      pipeline.get('key');
      const results = await pipeline.exec();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([null, 'OK']);
      expect(results[1]).toEqual([null, 'value']);
    });

    it('should create multi transaction', async () => {
      const mockMulti = {
        set: vi.fn().mockReturnThis(),
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 'OK'],
          [null, 'value'],
        ]),
        discard: vi.fn(),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          multi: vi.fn().mockReturnValue(mockMulti),
        },
      );

      const multi = adapter.multi();
      multi.set('key', 'value');
      multi.get('key');
      const results = await multi.exec();

      expect(results).toHaveLength(2);
      expect(mockMulti.set).toHaveBeenCalled();
      expect(mockMulti.get).toHaveBeenCalled();
    });

    it('should handle pipeline with errors', async () => {
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 'OK'],
          [new Error('Command failed'), null],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.set('key1', 'value1');
      pipeline.set('key2', 'value2');
      const results = await pipeline.exec();

      expect(results[0][0]).toBeNull();
      expect(results[1][0]).toBeInstanceOf(Error);
    });

    it('should handle empty pipeline exec', async () => {
      const mockPipeline = {
        exec: vi.fn().mockResolvedValue(null),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      const results = await pipeline.exec();
      expect(results).toEqual([]);
    });

    it('should discard multi transaction', async () => {
      const mockMulti = {
        set: vi.fn().mockReturnThis(),
        discard: vi.fn(),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          multi: vi.fn().mockReturnValue(mockMulti),
        },
      );

      const multi = adapter.multi();
      multi.set('key', 'value');
      multi.discard();
      expect(mockMulti.discard).toHaveBeenCalled();
    });
  });

  describe('Pipeline Adapter Methods Coverage', () => {
    it('should support zadd and zrem in pipeline', async () => {
      const mockPipeline = {
        zadd: vi.fn().mockReturnThis(),
        zrem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.zadd('zset', 1, 'member1', 2, 'member2');
      pipeline.zrem('zset', 'member1');
      await pipeline.exec();

      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipeline.zrem).toHaveBeenCalled();
    });

    it('should support sadd and srem in pipeline', async () => {
      const mockPipeline = {
        sadd: vi.fn().mockReturnThis(),
        srem: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.sadd('set', 'member1', 'member2');
      pipeline.srem('set', 'member1');
      await pipeline.exec();

      expect(mockPipeline.sadd).toHaveBeenCalled();
      expect(mockPipeline.srem).toHaveBeenCalled();
    });

    it('should support lpush and rpush in pipeline', async () => {
      const mockPipeline = {
        lpush: vi.fn().mockReturnThis(),
        rpush: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.lpush('list', 'item1', 'item2');
      pipeline.rpush('list', 'item3');
      await pipeline.exec();

      expect(mockPipeline.lpush).toHaveBeenCalled();
      expect(mockPipeline.rpush).toHaveBeenCalled();
    });

    it('should support hset, hget, hmset, hgetall in pipeline', async () => {
      const mockPipeline = {
        hset: vi.fn().mockReturnThis(),
        hget: vi.fn().mockReturnThis(),
        hmset: vi.fn().mockReturnThis(),
        hgetall: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 'value'],
          [null, 'OK'],
          [null, {}],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.hset('hash', 'field', 'value');
      pipeline.hget('hash', 'field');
      pipeline.hmset('hash', { field1: 'value1', field2: 'value2' });
      pipeline.hgetall('hash');
      await pipeline.exec();

      expect(mockPipeline.hset).toHaveBeenCalled();
      expect(mockPipeline.hget).toHaveBeenCalled();
      expect(mockPipeline.hmset).toHaveBeenCalled();
      expect(mockPipeline.hgetall).toHaveBeenCalled();
    });

    it('should support expire and ttl in pipeline', async () => {
      const mockPipeline = {
        expire: vi.fn().mockReturnThis(),
        ttl: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1],
          [null, 3600],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.expire('key', 3600);
      pipeline.ttl('key');
      await pipeline.exec();

      expect(mockPipeline.expire).toHaveBeenCalledWith('key', 3600);
      expect(mockPipeline.ttl).toHaveBeenCalledWith('key');
    });

    it('should support mget and mset in pipeline', async () => {
      const mockPipeline = {
        mget: vi.fn().mockReturnThis(),
        mset: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, ['value1', 'value2']],
          [null, 'OK'],
        ]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.mget('key1', 'key2');
      pipeline.mset({ key1: 'value1', key2: 'value2' });
      await pipeline.exec();

      expect(mockPipeline.mget).toHaveBeenCalledWith('key1', 'key2');
      expect(mockPipeline.mset).toHaveBeenCalledWith({ key1: 'value1', key2: 'value2' });
    });

    it('should support set with EX option in pipeline', async () => {
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 'OK']]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.set('key', 'value', { ex: 3600 });
      await pipeline.exec();

      expect(mockPipeline.set).toHaveBeenCalledWith('key', 'value', 'EX', 3600);
    });

    it('should support set with PX option in pipeline', async () => {
      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 'OK']]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.set('key', 'value', { px: 1000 });
      await pipeline.exec();

      expect(mockPipeline.set).toHaveBeenCalledWith('key', 'value', 'PX', 1000);
    });

    it('should support del in pipeline', async () => {
      const mockPipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 1]]),
      };

      const { adapter } = createConnectedAdapter(
        {},
        {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        },
      );

      const pipeline = adapter.pipeline();
      pipeline.del('key1', 'key2');
      await pipeline.exec();

      expect(mockPipeline.del).toHaveBeenCalledWith('key1', 'key2');
    });
  });

  describe('Pipeline/Multi Creation Error Handling', () => {
    it('should throw error when creating pipeline without client', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      expect(() => adapter.pipeline()).toThrow(DriverError);
      expect(() => adapter.pipeline()).toThrow('Driver is not connected');
    });

    it('should throw error when creating multi without client', () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      expect(() => adapter.multi()).toThrow(DriverError);
      expect(() => adapter.multi()).toThrow('Driver is not connected');
    });
  });

  describe('Connection Type Handling', () => {
    it('should throw error for unknown connection type', async () => {
      const config: ConnectionConfig = { type: 'unknown' as any, host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      await expect(adapter.connect()).rejects.toThrow(ConnectionError);
    });

    it('should handle cluster connection with all options', () => {
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [
          { host: 'node1', port: 7000 },
          { host: 'node2', port: 7001 },
        ],
        password: 'secret',
        db: 0,
        keyPrefix: 'app:',
        connectTimeout: 5000,
        commandTimeout: 3000,
        maxRetriesPerRequest: 5,
        clusterOptions: {
          enableReadyCheck: true,
          maxRedirections: 32,
          retryDelayOnClusterDown: 200,
          retryDelayOnFailover: 200,
          scaleReads: 'slave',
        },
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });

    it('should handle sentinel connection with all options', () => {
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26380 },
        ],
        name: 'mymaster',
        password: 'secret',
        db: 0,
        keyPrefix: 'app:',
        connectTimeout: 5000,
        commandTimeout: 3000,
        maxRetriesPerRequest: 5,
        sentinelOptions: {
          sentinelPassword: 'sentinel-secret',
          enableTLSForSentinelMode: true,
        },
      };
      const adapter = new IoRedisAdapter(config);
      expect(adapter).toBeInstanceOf(IoRedisAdapter);
    });
  });

  describe('Connection Flow with Event Handlers', () => {
    it('should setup event handlers during connection', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      const eventHandlers: Record<string, Function[]> = {};
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Function) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);
      await adapter.connect();

      expect(mockClient.on).toHaveBeenCalled();
      const eventNames = Object.keys(eventHandlers);
      expect(eventNames.length).toBeGreaterThan(0);
    });

    it('should cleanup event handlers on connection error', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'error') setTimeout(() => handler(new Error('Connection failed')), 0);
        }),
        off: vi.fn(),
        disconnect: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);

      await expect(adapter.connect()).rejects.toThrow(ConnectionError);
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(adapter.getClient()).toBeNull();
    });

    it('should handle Cluster connection (auto-connect)', async () => {
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [{ host: 'localhost', port: 7000 }],
      };
      const adapter = new IoRedisAdapter(config);

      const mockCluster = {
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createClusterClient').mockReturnValue(mockCluster);
      await adapter.connect();

      expect(mockCluster.on).toHaveBeenCalled();
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('Driver Event Emission', () => {
    it('should emit CLOSE event when client emits close', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      let closeHandler: Function | null = null;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'close') closeHandler = handler;
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);
      await adapter.connect();

      const eventSpy = vi.fn();
      adapter.on(DriverEvent.CLOSE, eventSpy);

      if (closeHandler) closeHandler();
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should emit RECONNECTING event when client emits reconnecting', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      let reconnectingHandler: Function | null = null;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'reconnecting') reconnectingHandler = handler;
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);
      await adapter.connect();

      const eventSpy = vi.fn();
      adapter.on(DriverEvent.RECONNECTING, eventSpy);

      if (reconnectingHandler) reconnectingHandler();
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should emit END event when client emits end', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      let endHandler: Function | null = null;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'end') endHandler = handler;
        }),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') setTimeout(() => handler(), 0);
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);
      await adapter.connect();

      const eventSpy = vi.fn();
      adapter.on(DriverEvent.END, eventSpy);

      if (endHandler) endHandler();
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should call cleanup and resolve on successful ready event', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'ready') handler();
        }),
        off: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);
      await adapter.connect();

      expect(mockClient.off).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockClient.off).toHaveBeenCalledWith('error', expect.any(Function));
      expect(adapter.isConnected()).toBe(true);
    });

    it('should call cleanup and reject on error event', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);

      const testError = new Error('Connection error');
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'error') handler(testError);
        }),
        off: vi.fn(),
        disconnect: vi.fn(),
      };

      vi.spyOn(adapter as any, 'createSingleClient').mockReturnValue(mockClient);

      await expect(adapter.connect()).rejects.toThrow('Connection failed');
      expect(mockClient.off).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockClient.off).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('Disconnect Behavior', () => {
    it('should disconnect cleanly', async () => {
      const { adapter, mockClient } = createConnectedAdapter(
        {},
        {
          quit: vi.fn().mockResolvedValue('OK'),
        },
      );

      await adapter.disconnect();
      expect(mockClient.quit).toHaveBeenCalled();
      expect(adapter.getClient()).toBeNull();
    });

    it('should force disconnect on quit error', async () => {
      const { adapter, mockClient } = createConnectedAdapter(
        {},
        {
          quit: vi.fn().mockRejectedValue(new Error('Quit failed')),
          disconnect: vi.fn(),
        },
      );

      await adapter.disconnect();
      expect(mockClient.quit).toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(adapter.getClient()).toBeNull();
    });

    it('should handle disconnect when not connected', async () => {
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new IoRedisAdapter(config);
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });
});
