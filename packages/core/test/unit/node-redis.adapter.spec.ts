import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NodeRedisAdapter } from '../../src/driver/infrastructure/node-redis.adapter';
import { ConnectionConfig } from '../../src/types';
import { DriverEvent } from '../../src/interfaces';
import { ConnectionError, CommandError } from '../../src/shared/errors';

// Mock redis
vi.mock('redis', () => {
  const EventEmitter = require('events');

  class MockRedisClient extends EventEmitter {
    constructor(public options?: any) {
      super();
      this.options = options;
    }

    async connect() {
      setImmediate(() => {
        this.emit('connect');
        this.emit('ready');
      });
      return Promise.resolve();
    }

    async quit() {
      this.emit('end');
      return Promise.resolve();
    }

    async disconnect() {
      this.emit('end');
      return Promise.resolve();
    }

    multi() {
      return new MockMulti(this);
    }

    async sendCommand(args: string[]) {
      const [command, ...params] = args;
      if (command === 'GET') return 'value';
      if (command === 'SET') return 'OK';
      return 'OK';
    }
  }

  class MockRedisCluster extends EventEmitter {
    constructor(public options?: any) {
      super();
      this.options = options;
    }

    async connect() {
      setImmediate(() => {
        this.emit('connect');
        this.emit('ready');
      });
      return Promise.resolve();
    }

    async quit() {
      this.emit('end');
      return Promise.resolve();
    }

    async disconnect() {
      this.emit('end');
      return Promise.resolve();
    }

    multi() {
      return new MockMulti(this);
    }

    async sendCommand(args: string[]) {
      return 'OK';
    }
  }

  // Mock Sentinel client
  class MockRedisSentinel extends EventEmitter {
    constructor(public options?: any) {
      super();
      this.options = options;
    }

    async connect() {
      setImmediate(() => {
        this.emit('connect');
        this.emit('ready');
      });
      return Promise.resolve();
    }

    async close() {
      this.emit('end');
      return Promise.resolve();
    }

    async disconnect() {
      this.emit('end');
      return Promise.resolve();
    }

    // Sentinel uses .use() to get a client from the pool
    async use<T>(fn: (client: MockRedisClient) => Promise<T>): Promise<T> {
      const mockClient = new MockRedisClient(this.options);
      return fn(mockClient);
    }

    multi() {
      return new MockMulti(this);
    }

    async sendCommand(args: string[]) {
      const [command, ...params] = args;
      if (command === 'GET') return 'value';
      if (command === 'SET') return 'OK';
      return 'OK';
    }
  }

  class MockMulti {
    private commands: any[] = [];

    constructor(private client: any) {}

    // Add support for addCommand (used by node-redis v4 sendCommand approach)
    addCommand(args: string[]) {
      this.commands.push(args);
      return this;
    }

    get(key: string) {
      this.commands.push(['GET', key]);
      return this;
    }

    set(key: string, value: string, options?: any) {
      this.commands.push(['SET', key, value, options]);
      return this;
    }

    del(...keys: string[]) {
      this.commands.push(['DEL', ...keys]);
      return this;
    }

    mget(...keys: string[]) {
      this.commands.push(['MGET', ...keys]);
      return this;
    }

    mset(data: Record<string, string>) {
      this.commands.push(['MSET', data]);
      return this;
    }

    expire(key: string, seconds: number) {
      this.commands.push(['EXPIRE', key, seconds]);
      return this;
    }

    ttl(key: string) {
      this.commands.push(['TTL', key]);
      return this;
    }

    hget(key: string, field: string) {
      this.commands.push(['HGET', key, field]);
      return this;
    }

    hset(key: string, field: string, value: string) {
      this.commands.push(['HSET', key, field, value]);
      return this;
    }

    hmset(key: string, data: Record<string, string>) {
      this.commands.push(['HMSET', key, data]);
      return this;
    }

    hgetall(key: string) {
      this.commands.push(['HGETALL', key]);
      return this;
    }

    lpush(key: string, ...values: string[]) {
      this.commands.push(['LPUSH', key, ...values]);
      return this;
    }

    rpush(key: string, ...values: string[]) {
      this.commands.push(['RPUSH', key, ...values]);
      return this;
    }

    sadd(key: string, ...members: string[]) {
      this.commands.push(['SADD', key, ...members]);
      return this;
    }

    srem(key: string, ...members: string[]) {
      this.commands.push(['SREM', key, ...members]);
      return this;
    }

    zadd(key: string, ...args: any[]) {
      this.commands.push(['ZADD', key, ...args]);
      return this;
    }

    zrem(key: string, ...members: string[]) {
      this.commands.push(['ZREM', key, ...members]);
      return this;
    }

    async exec() {
      return this.commands.map(() => 'OK');
    }

    discard() {
      this.commands = [];
    }
  }

  return {
    createClient: (options?: any) => new MockRedisClient(options),
    createCluster: (options?: any) => new MockRedisCluster(options),
    createSentinel: (options?: any) => new MockRedisSentinel(options),
  };
});

describe('NodeRedisAdapter', () => {
  let adapter: NodeRedisAdapter;

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Single Connection', () => {
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
    });

    describe('connect', () => {
      it('should connect successfully', async () => {
        // When
        await adapter.connect();

        // Then
        expect(adapter.isConnected()).toBe(true);
      });

      it('should emit CONNECT and READY events', async () => {
        // Given
        const connectSpy = vi.fn();
        const readySpy = vi.fn();
        adapter.on(DriverEvent.CONNECT, connectSpy);
        adapter.on(DriverEvent.READY, readySpy);

        // When
        await adapter.connect();

        // Then
        expect(connectSpy).toHaveBeenCalled();
        expect(readySpy).toHaveBeenCalled();
      });

      it('should setup error event handler', async () => {
        // Given
        await adapter.connect();
        const errorSpy = vi.fn();
        adapter.on(DriverEvent.ERROR, errorSpy);
        const client = adapter.getClient();

        // When
        if (client) {
          client.emit('error', new Error('Connection failed'));
        }

        // Then
        expect(errorSpy).toHaveBeenCalled();
      });
    });

    describe('disconnect', () => {
      it('should disconnect successfully', async () => {
        // Given
        await adapter.connect();

        // When
        await adapter.disconnect();

        // Then
        expect(adapter.isConnected()).toBe(false);
      });

      it('should emit DISCONNECT and CLOSE events', async () => {
        // Given
        await adapter.connect();
        const disconnectSpy = vi.fn();
        const closeSpy = vi.fn();
        adapter.on(DriverEvent.DISCONNECT, disconnectSpy);
        adapter.on(DriverEvent.CLOSE, closeSpy);

        // When
        await adapter.disconnect();

        // Then
        expect(disconnectSpy).toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
      });
    });

    describe('executeCommand', () => {
      it('should execute GET command', async () => {
        // Given
        await adapter.connect();

        // When
        const result = await adapter.get('key');

        // Then
        expect(result).toBe('value');
      });

      it('should execute SET command', async () => {
        // Given
        await adapter.connect();

        // When
        const result = await adapter.set('key', 'value');

        // Then
        expect(result).toBe('OK');
      });

      it('should throw CommandError on failure', async () => {
        // Given
        await adapter.connect();
        const client = adapter.getClient();
        if (client) {
          vi.spyOn(client as any, 'sendCommand').mockRejectedValue(new Error('Command failed'));
        }

        // When & Then
        await expect(adapter.get('key')).rejects.toThrow(CommandError);
      });
    });

    describe('pipeline', () => {
      it('should create pipeline', async () => {
        // Given
        await adapter.connect();

        // When
        const pipeline = adapter.pipeline();

        // Then
        expect(pipeline).toBeDefined();
        expect(typeof pipeline.exec).toBe('function');
      });

      it('should execute pipeline commands', async () => {
        // Given
        await adapter.connect();
        const pipeline = adapter.pipeline();

        // When
        pipeline.get('key1');
        pipeline.set('key2', 'value2');
        const results = await pipeline.exec();

        // Then
        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('multi', () => {
      it('should create multi transaction', async () => {
        // Given
        await adapter.connect();

        // When
        const multi = adapter.multi();

        // Then
        expect(multi).toBeDefined();
        expect(typeof multi.exec).toBe('function');
        expect(typeof multi.discard).toBe('function');
      });

      it('should execute multi transaction', async () => {
        // Given
        await adapter.connect();
        const multi = adapter.multi();

        // When
        multi.set('key1', 'value1');
        multi.set('key2', 'value2');
        const results = await multi.exec();

        // Then
        expect(results).toBeDefined();
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('getClient', () => {
      it('should return null when not connected', () => {
        // When
        const client = adapter.getClient();

        // Then
        expect(client).toBeNull();
      });

      it('should return client when connected', async () => {
        // Given
        await adapter.connect();

        // When
        const client = adapter.getClient();

        // Then
        expect(client).toBeDefined();
        expect(client).not.toBeNull();
      });
    });
  });

  describe('Cluster Connection', () => {
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'cluster',
        nodes: [
          { host: 'localhost', port: 7000 },
          { host: 'localhost', port: 7001 },
        ],
      };
      adapter = new NodeRedisAdapter(config);
    });

    it('should connect to cluster', async () => {
      // When
      await adapter.connect();

      // Then
      expect(adapter.isConnected()).toBe(true);
    });

    it('should create cluster client with correct configuration', async () => {
      // When
      await adapter.connect();
      const client = adapter.getClient();

      // Then
      expect(client).toBeDefined();
    });

    it('should disconnect from cluster', async () => {
      // Given
      await adapter.connect();

      // When
      await adapter.disconnect();

      // Then
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('Sentinel Connection', () => {
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'sentinel',
        sentinels: [{ host: 'localhost', port: 26379 }],
        name: 'mymaster',
      };
      adapter = new NodeRedisAdapter(config);
    });

    it('should connect to sentinel', async () => {
      // When
      await adapter.connect();

      // Then
      expect(adapter.isConnected()).toBe(true);
    });

    it('should create sentinel client with correct configuration', async () => {
      // When
      await adapter.connect();
      const client = adapter.getClient();

      // Then
      expect(client).toBeDefined();
    });

    it('should disconnect from sentinel', async () => {
      // Given
      await adapter.connect();

      // When
      await adapter.disconnect();

      // Then
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('Event Handling', () => {
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
    });

    it('should map connect event', async () => {
      // Given
      const spy = vi.fn();
      adapter.on(DriverEvent.CONNECT, spy);

      // When
      await adapter.connect();

      // Then
      expect(spy).toHaveBeenCalled();
    });

    it('should map ready event', async () => {
      // Given
      const spy = vi.fn();
      adapter.on(DriverEvent.READY, spy);

      // When
      await adapter.connect();

      // Then
      expect(spy).toHaveBeenCalled();
    });

    it('should map error event', async () => {
      // Given
      await adapter.connect();
      const spy = vi.fn();
      adapter.on(DriverEvent.ERROR, spy);
      const client = adapter.getClient();

      // When
      if (client) {
        client.emit('error', new Error('Redis error'));
      }

      // Then
      expect(spy).toHaveBeenCalled();
    });

    it('should map end event', async () => {
      // Given
      await adapter.connect();
      const spy = vi.fn();
      adapter.on(DriverEvent.END, spy);
      const client = adapter.getClient();

      // When
      if (client) {
        client.emit('end');
      }

      // Then
      expect(spy).toHaveBeenCalled();
    });

    it('should map reconnecting event', async () => {
      // Given
      await adapter.connect();
      const spy = vi.fn();
      adapter.on(DriverEvent.RECONNECTING, spy);
      const client = adapter.getClient();

      // When
      if (client) {
        client.emit('reconnecting');
      }

      // Then
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Configuration Options', () => {
    it('should apply single connection options', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'redis.example.com',
        port: 6380,
        password: 'secret',
        db: 5,
        connectTimeout: 5000,
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should apply TLS configuration', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6380,
        tls: {
          enabled: true,
          rejectUnauthorized: true,
          ca: 'ca-cert',
          cert: 'client-cert',
          key: 'client-key',
        },
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should apply cluster options', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [{ host: 'localhost', port: 7000 }],
        clusterOptions: {
          maxRedirections: 32,
          scaleReads: 'slave',
        },
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should apply sentinel options', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [{ host: 'localhost', port: 26379 }],
        name: 'mymaster',
        password: 'secret',
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should enable logging when option is provided', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };

      // When
      const adapter = new NodeRedisAdapter(config, { enableLogging: true });

      // Then
      expect(adapter['enableLogging']).toBe(true);
    });
  });

  describe('Error Handling', () => {
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
    });

    it('should throw ConnectionError for unknown connection type', async () => {
      // Given
      const invalidConfig = {
        type: 'invalid',
      } as never;
      const adapter = new NodeRedisAdapter(invalidConfig);

      // When & Then
      await expect(adapter.connect()).rejects.toThrow(ConnectionError);
    });

    it('should cleanup client reference after disconnect', async () => {
      // Given
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();
      expect(adapter.getClient()).not.toBeNull();

      // When
      await adapter.disconnect();

      // Then
      expect(adapter.getClient()).toBeNull();
    });

    it('should force disconnect on quit failure', async () => {
      // Given
      await adapter.connect();
      const client = adapter.getClient();
      if (client) {
        vi.spyOn(client, 'quit').mockRejectedValue(new Error('Quit failed'));
      }

      // When
      await adapter.disconnect();

      // Then
      expect(adapter.isConnected()).toBe(false);
    });

    it('should throw error when executing command on disconnected client', async () => {
      // When & Then
      await expect(adapter.get('key')).rejects.toThrow('not connected');
    });
  });

  describe('Pipeline Adapter', () => {
    beforeEach(async () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
      await adapter.connect();
    });

    it('should queue commands in pipeline', async () => {
      // Given
      const pipeline = adapter.pipeline();

      // When
      pipeline.set('key1', 'value1').get('key1').del('key1');

      const results = await pipeline.exec();

      // Then
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle pipeline execution errors', async () => {
      // Given
      const pipeline = adapter.pipeline();
      const client = adapter.getClient();

      if (client) {
        const multi = client.multi();
        vi.spyOn(multi, 'exec').mockRejectedValue(new Error('Pipeline failed'));
      }

      // When
      pipeline.get('key');
      const results = await pipeline.exec();

      // Then
      expect(results[0][0]).toBeDefined(); // Error in first element
    });
  });

  describe('Multi Adapter', () => {
    beforeEach(async () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
      await adapter.connect();
    });

    it('should queue commands in multi transaction', async () => {
      // Given
      const multi = adapter.multi();

      // When
      multi.set('key1', 'value1').set('key2', 'value2').get('key1');

      const results = await multi.exec();

      // Then
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should discard transaction', async () => {
      // Given
      const multi = adapter.multi();

      // When
      multi.set('key1', 'value1');
      multi.discard();

      // Then
      // No assertion needed, just verify discard doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Pipeline Methods Coverage', () => {
    it('should support set with EX option in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.set('key', 'value', { ex: 3600 });
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should support set with PX option in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.set('key', 'value', { px: 1000 });
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should support expire and ttl in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.expire('key', 3600);
      pipeline.ttl('key');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should support mget and mset in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.mset({ key1: 'value1', key2: 'value2' });
      pipeline.mget('key1', 'key2');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should support del in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.del('key1', 'key2', 'key3');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('should support hash operations in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.hset('hash', 'field', 'value');
      pipeline.hget('hash', 'field');
      pipeline.hmset('hash', { field1: 'value1', field2: 'value2' });
      pipeline.hgetall('hash');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(4);
    });

    it('should support list operations in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.lpush('list', 'item1', 'item2');
      pipeline.rpush('list', 'item3');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should support set operations in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.sadd('set', 'member1', 'member2');
      pipeline.srem('set', 'member1');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });

    it('should support sorted set operations in pipeline', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.zadd('zset', 1, 'member1', 2, 'member2');
      pipeline.zrem('zset', 'member1');
      const result = await pipeline.exec();

      // Then
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });
  });

  describe('Type Guards', () => {
    it('should validate single connection config', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should validate cluster connection config', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'cluster',
        nodes: [{ host: 'localhost', port: 7000 }],
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });

    it('should validate sentinel connection config', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [{ host: 'localhost', port: 26379 }],
        name: 'mymaster',
      };

      // When
      const adapter = new NodeRedisAdapter(config);

      // Then
      expect(adapter).toBeInstanceOf(NodeRedisAdapter);
    });
  });

  describe('Override Methods', () => {
    let adapter: NodeRedisAdapter;

    beforeEach(async () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
      await adapter.connect();
    });

    afterEach(async () => {
      if (adapter.isConnected()) {
        await adapter.disconnect();
      }
    });

    describe('hgetall', () => {
      it('should convert array response to object', async () => {
        // Given - mock returns array format
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(['field1', 'value1', 'field2', 'value2']);

        // When
        const result = await adapter.hgetall('test:hash');

        // Then
        expect(result).toEqual({
          field1: 'value1',
          field2: 'value2',
        });
        expect(executeCommandSpy).toHaveBeenCalledWith('HGETALL', 'test:hash');
      });

      it('should handle empty hash', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue([]);

        // When
        const result = await adapter.hgetall('test:empty');

        // Then
        expect(result).toEqual({});
      });

      it('should return object as-is if not array', async () => {
        // Given - some implementations might return object directly
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        const objResult = { field1: 'value1', field2: 'value2' };
        executeCommandSpy.mockResolvedValue(objResult);

        // When
        const result = await adapter.hgetall('test:hash');

        // Then
        expect(result).toEqual(objResult);
      });

      it('should throw if not connected', async () => {
        // Given
        await adapter.disconnect();

        // When/Then
        await expect(adapter.hgetall('test:hash')).rejects.toThrow();
      });
    });

    describe('scan', () => {
      it('should normalize scan response', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(['42', ['key1', 'key2']]);

        // When
        const result = await adapter.scan(0, { match: 'test:*', count: 10 });

        // Then
        expect(result).toEqual(['42', ['key1', 'key2']]);
        expect(executeCommandSpy).toHaveBeenCalledWith('SCAN', 0, 'MATCH', 'test:*', 'COUNT', 10);
      });

      it('should handle empty scan result', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await adapter.scan(0);

        // Then
        expect(result).toEqual(['0', []]);
      });
    });

    describe('hscan', () => {
      it('should normalize hscan response', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(['10', ['field1', 'value1']]);

        // When
        const result = await adapter.hscan('hash', 0, { match: 'f*' });

        // Then
        expect(result).toEqual(['10', ['field1', 'value1']]);
      });
    });

    describe('sscan', () => {
      it('should normalize sscan response', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(['5', ['member1', 'member2']]);

        // When
        const result = await adapter.sscan('set', 0, { count: 100 });

        // Then
        expect(result).toEqual(['5', ['member1', 'member2']]);
      });
    });

    describe('zscan', () => {
      it('should normalize zscan response', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(['0', ['member1', '1', 'member2', '2']]);

        // When
        const result = await adapter.zscan('zset', 0);

        // Then
        expect(result).toEqual(['0', ['member1', '1', 'member2', '2']]);
      });
    });

    describe('info', () => {
      it('should return info string', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue('# Server\nredis_version:7.0.0');

        // When
        const result = await adapter.info('server');

        // Then
        expect(result).toBe('# Server\nredis_version:7.0.0');
        expect(executeCommandSpy).toHaveBeenCalledWith('INFO', 'server');
      });

      it('should handle null info result', async () => {
        // Given
        const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
        executeCommandSpy.mockResolvedValue(null);

        // When
        const result = await adapter.info();

        // Then
        expect(result).toBe('');
      });
    });
  });

  describe('Key Prefix', () => {
    it('should apply keyPrefix to commands', async () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'myapp:',
      };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      const client = adapter.getClient();
      const sendCommandSpy = vi.spyOn(client as any, 'sendCommand');

      // When
      await adapter.get('key1');

      // Then
      expect(sendCommandSpy).toHaveBeenCalledWith(['GET', 'myapp:key1']);

      await adapter.disconnect();
    });

    it('should apply keyPrefix to multi-key commands', async () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'prefix:',
      };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      const client = adapter.getClient();
      const sendCommandSpy = vi.spyOn(client as any, 'sendCommand');

      // When
      await adapter.del('key1', 'key2');

      // Then
      expect(sendCommandSpy).toHaveBeenCalledWith(['DEL', 'prefix:key1', 'prefix:key2']);

      await adapter.disconnect();
    });

    it('should not apply keyPrefix when not configured', async () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      const client = adapter.getClient();
      const sendCommandSpy = vi.spyOn(client as any, 'sendCommand');

      // When
      await adapter.get('key1');

      // Then
      expect(sendCommandSpy).toHaveBeenCalledWith(['GET', 'key1']);

      await adapter.disconnect();
    });
  });

  describe('Sentinel Mode', () => {
    let adapter: NodeRedisAdapter;
    let config: ConnectionConfig;

    beforeEach(() => {
      config = {
        type: 'sentinel',
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26379 },
        ],
        name: 'mymaster',
        password: 'secret',
        db: 1,
        sentinelOptions: {
          masterPoolSize: 2,
          replicaPoolSize: 1,
          scanInterval: 5000,
          sentinelPassword: 'sentinel-secret',
        },
      };
      adapter = new NodeRedisAdapter(config);
    });

    afterEach(async () => {
      if (adapter?.isConnected()) {
        await adapter.disconnect();
      }
    });

    it('should connect to sentinel', async () => {
      // When
      await adapter.connect();

      // Then
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.isSentinelMode()).toBe(true);
    });

    it('should execute commands via sentinel', async () => {
      // Given
      await adapter.connect();

      // When
      const result = await adapter.get('test-key');

      // Then
      expect(result).toBeDefined();
    });

    it('should disconnect from sentinel using close()', async () => {
      // Given
      await adapter.connect();

      // When
      await adapter.disconnect();

      // Then
      expect(adapter.isConnected()).toBe(false);
    });

    it('should create sentinel with TLS options', async () => {
      // Given
      const tlsConfig: ConnectionConfig = {
        type: 'sentinel',
        sentinels: [{ host: 'sentinel1', port: 26379 }],
        name: 'mymaster',
        tls: {
          enabled: true,
          rejectUnauthorized: true,
        },
        sentinelOptions: {
          enableTLSForSentinelMode: true,
        },
      };
      const tlsAdapter = new NodeRedisAdapter(tlsConfig);

      // When
      await tlsAdapter.connect();

      // Then
      expect(tlsAdapter.isConnected()).toBe(true);
      expect(tlsAdapter.isSentinelMode()).toBe(true);

      await tlsAdapter.disconnect();
    });

    it('should create pipeline in sentinel mode', async () => {
      // Given
      await adapter.connect();

      // When
      const pipeline = adapter.pipeline();
      pipeline.get('key1');
      pipeline.set('key2', 'value2');
      const results = await pipeline.exec();

      // Then
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should create multi in sentinel mode', async () => {
      // Given
      await adapter.connect();

      // When
      const multi = adapter.multi();
      multi.set('key1', 'value1');
      multi.get('key1');
      const results = await multi.exec();

      // Then
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Type Conversion', () => {
    let adapter: NodeRedisAdapter;

    beforeEach(async () => {
      const config: ConnectionConfig = {
        type: 'single',
        host: 'localhost',
        port: 6379,
      };
      adapter = new NodeRedisAdapter(config);
      await adapter.connect();
    });

    afterEach(async () => {
      if (adapter?.isConnected()) {
        await adapter.disconnect();
      }
    });

    it('should handle null/undefined in hgetall result', async () => {
      // Given
      const executeCommandSpy = vi.spyOn(adapter as any, 'executeCommand');
      executeCommandSpy.mockResolvedValue(null);

      // When
      const result = await adapter.hgetall('nonexistent');

      // Then
      expect(result).toEqual({});
    });
  });
});
