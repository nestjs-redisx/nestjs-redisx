import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NodeRedisAdapter } from '../../src/driver/infrastructure/node-redis.adapter';
import { ConnectionConfig } from '../../src/types';
import { DriverEvent } from '../../src/interfaces';
import { ConnectionError, CommandError } from '../../src/shared/errors';

// Mock the driver loader (NOT the 'redis' module): the adapter loads the
// library at runtime through createRequire in driver-loader.ts, which
// bypasses Vitest's module graph - vi.mock('redis') would never intercept it.
vi.mock('../../src/driver/infrastructure/driver-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/driver/infrastructure/driver-loader')>();
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
    destroyed = false;

    constructor(public options?: any) {
      super();
      this.options = options;
      (globalThis as any).__lastMockSentinel = this;
    }

    async connect() {
      if (this.options?.name === 'fail-master') {
        throw new Error('no reachable master');
      }
      setImmediate(() => {
        this.emit('connect');
        this.emit('ready');
      });
      return Promise.resolve();
    }

    async destroy() {
      this.destroyed = true;
    }

    async close() {
      this.emit('end');
      return Promise.resolve();
    }

    async disconnect() {
      this.emit('end');
      return Promise.resolve();
    }

    // Sentinel uses .use() to get a client from the pool. The pooled
    // client's sendCommand signature is (isReadonly, args, options) -
    // mirror it, or the adapter's dispatch shape goes untested.
    async use<T>(fn: (client: MockRedisClient) => Promise<T>): Promise<T> {
      const mockClient = new MockRedisClient(this.options);
      const pooled = Object.create(mockClient) as MockRedisClient & { sendCommand: (isReadonly: boolean | undefined, args: string[], options?: unknown) => Promise<unknown> };
      pooled.sendCommand = (isReadonly: boolean | undefined, args: string[]) => {
        if (typeof isReadonly !== 'boolean' && isReadonly !== undefined) {
          return Promise.reject(new TypeError('sentinel sendCommand called with the single-client (args, options) shape'));
        }
        if (!Array.isArray(args)) {
          return Promise.reject(new TypeError("Cannot read properties of undefined (reading 'length')"));
        }
        return mockClient.sendCommand(args);
      };
      return fn(pooled);
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

    // Mirrors the three real @redis/client v5 shapes: single (args),
    // cluster (firstKey, isReadonly, args), sentinel (isReadonly, args) -
    // the command array is always the array parameter.
    addCommand(...params: unknown[]) {
      const args = params.find((p) => Array.isArray(p)) as string[];
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
      // Simulate v5's MultiErrorReply: any command touching a 'boom' key
      // makes exec throw an error carrying per-command replies.
      if (this.commands.some((c) => c.includes('boom'))) {
        const error: any = new Error('MultiErrorReply');
        error.replies = this.commands.map((c) => (c.includes('boom') ? new Error('WRONGTYPE') : 'OK'));
        error.errorIndexes = this.commands.map((c, i) => (c.includes('boom') ? i : -1)).filter((i) => i >= 0);
        throw error;
      }
      return this.commands.map(() => 'OK');
    }

    discard() {
      this.commands = [];
    }
  }

  return {
    ...actual,
    loadNodeRedis: () => ({
      createClient: (options?: any) => new MockRedisClient(options),
      createCluster: (options?: any) => new MockRedisCluster(options),
      createSentinel: (options?: any) => new MockRedisSentinel(options),
    }),
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

    it('should apply ACL authentication with username', () => {
      // Given
      const config: ConnectionConfig = {
        type: 'single',
        host: 'redis.example.com',
        port: 6379,
        username: 'app-user',
        password: 'secure-password',
        db: 0,
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
        username: 'app-user',
        password: 'secret',
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
        username: 'app-user',
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

    it('should apply keyPrefix to the declared keys of EVAL (parity with ioredis - scripts and plain commands must hit the SAME keys)', async () => {
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

      // When - one declared key, two plain args
      await adapter.eval('return 1', ['leader:default'], ['node-1', 15000]);

      // Then - the key is prefixed, script/numkeys/args are untouched
      expect(sendCommandSpy).toHaveBeenCalledWith(['EVAL', 'return 1', '1', 'myapp:leader:default', 'node-1', '15000']);

      await adapter.disconnect();
    });

    it('should apply keyPrefix to every declared key of EVALSHA and leave args alone', async () => {
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

      // When - two declared keys, one plain arg
      await adapter.evalsha('abc123', ['k1', 'k2'], ['value']);

      // Then
      expect(sendCommandSpy).toHaveBeenCalledWith(['EVALSHA', 'abc123', '2', 'myapp:k1', 'myapp:k2', 'value']);

      await adapter.disconnect();
    });

    it('should leave EVAL args untouched when the script declares no keys', async () => {
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
      await adapter.eval('return 1', [], ['only-an-arg']);

      // Then - nothing to prefix
      expect(sendCommandSpy).toHaveBeenCalledWith(['EVAL', 'return 1', '0', 'only-an-arg']);

      await adapter.disconnect();
    });
  });

  describe('Command Timeout (opt-in)', () => {
    it('should reject a command that outlives the configured commandTimeout', async () => {
      // Given - a hung connection: sendCommand never settles
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379, commandTimeout: 20 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();
      const client = adapter.getClient();
      vi.spyOn(client as any, 'sendCommand').mockImplementation(() => new Promise(() => undefined));

      // When/Then - the wait is abandoned at the deadline instead of
      // hanging until TCP retransmission death
      await expect(adapter.get('key1')).rejects.toThrow(CommandError);
      await expect(adapter.get('key1')).rejects.toThrow('timed out after 20ms');

      await adapter.disconnect();
    });

    it('should not impose any deadline when commandTimeout is not configured', async () => {
      // Given
      const config: ConnectionConfig = { type: 'single', host: 'localhost', port: 6379 };
      const adapter = new NodeRedisAdapter(config);
      await adapter.connect();

      // When/Then
      await expect(adapter.get('key1')).resolves.toBe('value');

      await adapter.disconnect();
    });
  });

  describe('Offline Queue Option', () => {
    it('should forward enableOfflineQueue:false as the real node-redis knob (disableOfflineQueue)', async () => {
      // Given - commandsQueueMaxLength: 0 looked equivalent but the library
      // treats 0 as "no limit", so the option was silently dead
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379, enableOfflineQueue: false });
      await adapter.connect();

      // Then
      expect((adapter.getClient() as any).options.disableOfflineQueue).toBe(true);

      await adapter.disconnect();
    });

    it('should leave the offline queue enabled by default', async () => {
      // Given
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379 });
      await adapter.connect();

      // Then
      expect((adapter.getClient() as any).options.disableOfflineQueue).toBe(false);

      await adapter.disconnect();
    });
  });

  describe('Bounded graceful close', () => {
    it('should force-disconnect when quit() pends past the deadline instead of hanging shutdown forever', async () => {
      // Given - a quit landing in a reconnect window pends forever in
      // @redis/client (the queued QUIT has no timeout and the reconnect
      // loop exits without flushing it); commandTimeout doubles as the
      // close deadline
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379, commandTimeout: 20 });
      await adapter.connect();
      const client = adapter.getClient() as any;
      vi.spyOn(client, 'quit').mockImplementation(() => new Promise(() => undefined));
      const disconnectSpy = vi.spyOn(client, 'disconnect');

      // When - disconnect must SETTLE (previously: closeAll and the whole
      // application shutdown hung until SIGKILL)
      await adapter.disconnect();

      // Then - the force path ran
      expect(disconnectSpy).toHaveBeenCalled();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should keep a REAL close deadline when commandTimeout is 0 - "no per-command deadline" must not mean a 0ms close race', async () => {
      // Given - commandTimeout: 0 disables the per-command deadline; the
      // graceful close still needs its 5s bound (previously `0 ?? 5000`
      // kept the 0 and every shutdown force-disconnected)
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379, commandTimeout: 0 });
      await adapter.connect();
      const client = adapter.getClient() as any;
      const disconnectSpy = vi.spyOn(client, 'disconnect');

      // When - a quit that resolves promptly must WIN the race
      await adapter.disconnect();

      // Then - graceful path, no force disconnect
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('Pipeline batch errors', () => {
    it('should map a MultiErrorReply back to per-slot [error|null, result] tuples instead of collapsing the batch', async () => {
      // Given - three queued commands, the middle one errors server-side
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379 });
      await adapter.connect();
      const pipeline = adapter.pipeline();
      pipeline.get('a').get('boom').get('c');

      // When
      const results = await pipeline.exec();

      // Then - positional contract preserved; successful replies kept
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([null, 'OK']);
      expect(results[1]?.[0]).toBeInstanceOf(Error);
      expect(results[1]?.[1]).toBeNull();
      expect(results[2]).toEqual([null, 'OK']);

      await adapter.disconnect();
    });
  });

  describe('Reconnect Strategy', () => {
    it('should bound the INITIAL connect but never give up after the first success', async () => {
      // Given - @redis/client applies the strategy to the initial
      // connection too: unbounded there, connect() would never settle and
      // bootstrap would hang silently; bounded after the first success, an
      // outage longer than the backoff sum (~2.5 min) closed the client
      // PERMANENTLY (a false return is terminal) and the fleet stayed
      // leaderless until every process restarted
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379 });
      const strategy = (adapter as any).buildReconnectStrategy((adapter as any).config) as (retries: number) => number | false;

      // Then - before any successful connect, the strategy gives up so the
      // initial connect() rejects instead of hanging bootstrap
      expect(typeof strategy(1)).toBe('number');
      expect(strategy(11)).toBe(false);

      // When - the first connect succeeds
      await adapter.connect();

      // Then - the same strategy now retries forever with a capped backoff
      expect(typeof strategy(11)).toBe('number');
      expect(typeof strategy(1000)).toBe('number');

      await adapter.disconnect();
    });

    it('should re-apply the initial-connect bound on every fresh connect (a reconnect cycle gets a brand-new client)', async () => {
      // Given - a connected-then-disconnected adapter
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379 });
      await adapter.connect();
      expect((adapter as any).everConnectedOnce).toBe(true);
      await adapter.disconnect();

      // When - the next connect creates a new client; capture the flag at
      // client-creation time (after doConnect's reset, before success)
      let flagDuringConnect: boolean | undefined;
      const original = (adapter as any).createSingleClient.bind(adapter);
      (adapter as any).createSingleClient = (cfg: unknown) => {
        flagDuringConnect = (adapter as any).everConnectedOnce;
        return original(cfg);
      };
      await adapter.connect();

      // Then - the bound governed the new INITIAL connection (with Redis
      // down it must settle instead of retrying forever), and the flag is
      // back after success
      expect(flagDuringConnect).toBe(false);
      expect((adapter as any).everConnectedOnce).toBe(true);

      await adapter.disconnect();
    });

    it('should disable reconnection entirely when enableAutoReconnect is false', async () => {
      // Given
      const adapter = new NodeRedisAdapter({ type: 'single', host: 'localhost', port: 6379, enableAutoReconnect: false });
      await adapter.connect();

      // Then - reconnectStrategy: false is node-redis's "stay down" knob
      expect((adapter.getClient() as any).options.socket.reconnectStrategy).toBe(false);

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

    it('should dispatch with the pooled-client signature (isReadonly, args, options?) - the single-client shape fails every command', async () => {
      // Given - the mock's pooled client rejects the (args, options) shape
      // the way the real one does (command array in the isReadonly slot)
      await adapter.connect();

      // When/Then
      await expect(adapter.get('test-key')).resolves.toBe('value');
      await expect(adapter.set('k', 'v')).resolves.toBe('OK');
    });

    it('should pass the native command timeout through the sentinel pooled client without corrupting the args slot', async () => {
      // Given
      const timeoutAdapter = new NodeRedisAdapter({ ...config, commandTimeout: 500 } as ConnectionConfig);
      await timeoutAdapter.connect();

      // When/Then
      await expect(timeoutAdapter.get('test-key')).resolves.toBe('value');

      await timeoutAdapter.disconnect();
    });

    it('should destroy the sentinel instance when the initial connect fails - a dropped instance leaks its scan interval', async () => {
      // Given - sentinels reachable but no usable master
      const failAdapter = new NodeRedisAdapter({ ...config, name: 'fail-master' } as ConnectionConfig);

      // When/Then - connect rejects instead of hanging
      await expect(failAdapter.connect()).rejects.toThrow();

      // And - the partially-initialized sentinel was destroyed, not dropped
      expect(((globalThis as any).__lastMockSentinel as { destroyed: boolean }).destroyed).toBe(true);
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
