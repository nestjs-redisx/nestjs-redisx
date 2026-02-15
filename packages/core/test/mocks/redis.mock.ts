import { vi, type MockedObject } from 'vitest';
import type { IRedisDriver, IPipeline, IMulti, ISetOptions, IScanOptions } from '../../src/interfaces';
import { DriverEvent } from '../../src/interfaces';
import type { ConnectionConfig, DriverType } from '../../src/types';
import { ConnectionStatus } from '../../src/types';

/**
 * Creates a mock pipeline for testing.
 */
export function createMockPipeline(): MockedObject<IPipeline> {
  const pipeline: MockedObject<IPipeline> = {
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
    hdel: vi.fn().mockReturnThis(),
    lpush: vi.fn().mockReturnThis(),
    rpush: vi.fn().mockReturnThis(),
    lpop: vi.fn().mockReturnThis(),
    rpop: vi.fn().mockReturnThis(),
    lrange: vi.fn().mockReturnThis(),
    sadd: vi.fn().mockReturnThis(),
    srem: vi.fn().mockReturnThis(),
    smembers: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zrem: vi.fn().mockReturnThis(),
    zrange: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    decr: vi.fn().mockReturnThis(),
  };
  return pipeline;
}

/**
 * Creates a mock multi for testing.
 */
export function createMockMulti(): MockedObject<IMulti> {
  const mockPipeline = createMockPipeline();
  return {
    ...mockPipeline,
    discard: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock Redis driver for testing.
 *
 * @param overrides - Partial overrides for driver methods
 * @returns Mocked IRedisDriver instance
 */
export function createMockRedisDriver(overrides?: Partial<IRedisDriver>): MockedObject<IRedisDriver> {
  const mockPipeline = createMockPipeline();
  const mockMulti = createMockMulti();

  const driver: MockedObject<IRedisDriver> = {
    // Connection management
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getStatus: vi.fn().mockReturnValue(ConnectionStatus.CONNECTED),
    ping: vi.fn().mockResolvedValue('PONG'),
    select: vi.fn().mockResolvedValue(undefined),

    // Events
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),

    // Key operations
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    expireat: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    pttl: vi.fn().mockResolvedValue(-1),
    persist: vi.fn().mockResolvedValue(1),
    rename: vi.fn().mockResolvedValue('OK'),
    renamenx: vi.fn().mockResolvedValue(1),
    type: vi.fn().mockResolvedValue('string'),
    keys: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(['0', []]),

    // String operations
    mget: vi.fn().mockResolvedValue([]),
    mset: vi.fn().mockResolvedValue('OK'),
    setnx: vi.fn().mockResolvedValue(1),
    setex: vi.fn().mockResolvedValue('OK'),
    getdel: vi.fn().mockResolvedValue(null),
    getex: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(-1),
    incrby: vi.fn().mockResolvedValue(1),
    decrby: vi.fn().mockResolvedValue(-1),
    append: vi.fn().mockResolvedValue(1),
    strlen: vi.fn().mockResolvedValue(0),

    // Hash operations
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    hmget: vi.fn().mockResolvedValue([]),
    hmset: vi.fn().mockResolvedValue('OK'),
    hgetall: vi.fn().mockResolvedValue({}),
    hdel: vi.fn().mockResolvedValue(1),
    hexists: vi.fn().mockResolvedValue(1),
    hkeys: vi.fn().mockResolvedValue([]),
    hvals: vi.fn().mockResolvedValue([]),
    hlen: vi.fn().mockResolvedValue(0),
    hincrby: vi.fn().mockResolvedValue(1),
    hscan: vi.fn().mockResolvedValue(['0', []]),

    // List operations
    lpush: vi.fn().mockResolvedValue(1),
    rpush: vi.fn().mockResolvedValue(1),
    lpop: vi.fn().mockResolvedValue(null),
    rpop: vi.fn().mockResolvedValue(null),
    lrange: vi.fn().mockResolvedValue([]),
    llen: vi.fn().mockResolvedValue(0),
    lindex: vi.fn().mockResolvedValue(null),
    lset: vi.fn().mockResolvedValue('OK'),
    ltrim: vi.fn().mockResolvedValue('OK'),

    // Set operations
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    sismember: vi.fn().mockResolvedValue(0),
    scard: vi.fn().mockResolvedValue(0),
    spop: vi.fn().mockResolvedValue(null),
    srandmember: vi.fn().mockResolvedValue(null),
    sscan: vi.fn().mockResolvedValue(['0', []]),

    // Sorted set operations
    zadd: vi.fn().mockResolvedValue(1),
    zrem: vi.fn().mockResolvedValue(1),
    zrange: vi.fn().mockResolvedValue([]),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    zrevrange: vi.fn().mockResolvedValue([]),
    zcard: vi.fn().mockResolvedValue(0),
    zscore: vi.fn().mockResolvedValue(null),
    zrank: vi.fn().mockResolvedValue(null),
    zincrby: vi.fn().mockResolvedValue('1'),
    zscan: vi.fn().mockResolvedValue(['0', []]),

    // Transaction/Pipeline
    pipeline: vi.fn().mockReturnValue(mockPipeline),
    multi: vi.fn().mockReturnValue(mockMulti),

    // Pub/Sub
    publish: vi.fn().mockResolvedValue(0),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    psubscribe: vi.fn().mockResolvedValue(undefined),
    punsubscribe: vi.fn().mockResolvedValue(undefined),

    // Scripting
    eval: vi.fn().mockResolvedValue(null),
    evalsha: vi.fn().mockResolvedValue(null),
    scriptLoad: vi.fn().mockResolvedValue(''),
    scriptExists: vi.fn().mockResolvedValue([1]),
    scriptFlush: vi.fn().mockResolvedValue('OK'),

    // Utility
    flushdb: vi.fn().mockResolvedValue('OK'),
    flushall: vi.fn().mockResolvedValue('OK'),
    dbsize: vi.fn().mockResolvedValue(0),
    info: vi.fn().mockResolvedValue(''),
    config: vi.fn().mockResolvedValue([]),

    // Raw command
    sendCommand: vi.fn().mockResolvedValue(null),

    // Apply overrides
    ...overrides,
  };

  return driver;
}

/**
 * Creates a mock Redis client (ioredis or node-redis compatible).
 *
 * @returns Mock client object
 */
export function createMockRedisClient() {
  return {
    status: 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    emit: vi.fn(),
  };
}

/**
 * Creates a mock connection config for testing.
 *
 * @param type - Connection type
 * @param overrides - Config overrides
 * @returns Connection config
 */
export function createMockConnectionConfig(type: DriverType = 'ioredis', overrides?: Partial<ConnectionConfig>): ConnectionConfig {
  const baseConfig = {
    type: 'single' as const,
    host: 'localhost',
    port: 6379,
    db: 0,
  };

  return {
    ...baseConfig,
    ...overrides,
  } as ConnectionConfig;
}

/**
 * Mock Redis driver class for testing.
 * Extends the mock driver with additional test utilities.
 */
export class MockRedisDriver implements IRedisDriver {
  private connected = false;
  private status = ConnectionStatus.DISCONNECTED;
  private eventListeners = new Map<string, Set<Function>>();

  constructor(
    public config: ConnectionConfig,
    public options?: { enableLogging?: boolean },
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
    this.status = ConnectionStatus.CONNECTED;
    this.emit(DriverEvent.CONNECTED);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.status = ConnectionStatus.DISCONNECTED;
    this.emit(DriverEvent.DISCONNECTED);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async ping(): Promise<string> {
    if (!this.connected) throw new Error('Not connected');
    return 'PONG';
  }

  on(event: DriverEvent, handler: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off(event: DriverEvent, handler: (...args: any[]) => void): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  once(event: DriverEvent, handler: (...args: any[]) => void): void {
    const onceWrapper = (...args: any[]) => {
      handler(...args);
      this.off(event, onceWrapper);
    };
    this.on(event, onceWrapper);
  }

  removeAllListeners(event?: DriverEvent): void {
    if (event) {
      this.eventListeners.delete(event);
    } else {
      this.eventListeners.clear();
    }
  }

  private emit(event: DriverEvent, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach((handler) => handler(...args));
  }

  // Key operations
  async get(key: string): Promise<string | null> {
    return null;
  }
  async set(key: string, value: string, options?: ISetOptions): Promise<string> {
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    return keys.length;
  }
  async exists(...keys: string[]): Promise<number> {
    return 0;
  }
  async expire(key: string, seconds: number): Promise<number> {
    return 1;
  }
  async ttl(key: string): Promise<number> {
    return -1;
  }
  async keys(pattern: string): Promise<string[]> {
    return [];
  }
  async scan(cursor: string, options?: IScanOptions): Promise<{ cursor: string; keys: string[] }> {
    return { cursor: '0', keys: [] };
  }

  // String operations
  async mget(...keys: string[]): Promise<(string | null)[]> {
    return [];
  }
  async mset(...args: (string | number)[]): Promise<string> {
    return 'OK';
  }
  async incr(key: string): Promise<number> {
    return 1;
  }
  async decr(key: string): Promise<number> {
    return -1;
  }
  async incrby(key: string, increment: number): Promise<number> {
    return increment;
  }
  async decrby(key: string, decrement: number): Promise<number> {
    return -decrement;
  }
  async append(key: string, value: string): Promise<number> {
    return value.length;
  }
  async strlen(key: string): Promise<number> {
    return 0;
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    return null;
  }
  async hset(key: string, field: string, value: string): Promise<number> {
    return 1;
  }
  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    return [];
  }
  async hmset(key: string, ...args: (string | number)[]): Promise<string> {
    return 'OK';
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return {};
  }
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return fields.length;
  }
  async hexists(key: string, field: string): Promise<number> {
    return 0;
  }
  async hkeys(key: string): Promise<string[]> {
    return [];
  }
  async hvals(key: string): Promise<string[]> {
    return [];
  }
  async hlen(key: string): Promise<number> {
    return 0;
  }
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return increment;
  }

  // List operations
  async lpush(key: string, ...values: (string | number)[]): Promise<number> {
    return values.length;
  }
  async rpush(key: string, ...values: (string | number)[]): Promise<number> {
    return values.length;
  }
  async lpop(key: string): Promise<string | null> {
    return null;
  }
  async rpop(key: string): Promise<string | null> {
    return null;
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return [];
  }
  async llen(key: string): Promise<number> {
    return 0;
  }
  async lindex(key: string, index: number): Promise<string | null> {
    return null;
  }
  async lset(key: string, index: number, value: string): Promise<string> {
    return 'OK';
  }
  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return 'OK';
  }

  // Set operations
  async sadd(key: string, ...members: (string | number)[]): Promise<number> {
    return members.length;
  }
  async srem(key: string, ...members: (string | number)[]): Promise<number> {
    return members.length;
  }
  async smembers(key: string): Promise<string[]> {
    return [];
  }
  async sismember(key: string, member: string): Promise<number> {
    return 0;
  }
  async scard(key: string): Promise<number> {
    return 0;
  }
  async spop(key: string, count?: number): Promise<string | string[] | null> {
    return null;
  }
  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    return null;
  }

  // Sorted set operations
  async zadd(key: string, ...args: (string | number)[]): Promise<number> {
    return 1;
  }
  async zrem(key: string, ...members: (string | number)[]): Promise<number> {
    return members.length;
  }
  async zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    return [];
  }
  async zrangebyscore(key: string, min: string | number, max: string | number, withScores?: boolean): Promise<string[]> {
    return [];
  }
  async zrevrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    return [];
  }
  async zcard(key: string): Promise<number> {
    return 0;
  }
  async zscore(key: string, member: string): Promise<string | null> {
    return null;
  }
  async zrank(key: string, member: string): Promise<number | null> {
    return null;
  }
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    return String(increment);
  }

  // Transaction/Pipeline
  pipeline(): IPipeline {
    const mockPipeline: IPipeline = {
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
      hdel: vi.fn().mockReturnThis(),
      lpush: vi.fn().mockReturnThis(),
      rpush: vi.fn().mockReturnThis(),
      lpop: vi.fn().mockReturnThis(),
      rpop: vi.fn().mockReturnThis(),
      lrange: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      srem: vi.fn().mockReturnThis(),
      smembers: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      zrange: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      decr: vi.fn().mockReturnThis(),
    };
    return mockPipeline;
  }

  multi(): IMulti {
    const mockMulti: IMulti = {
      ...this.pipeline(),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    return mockMulti;
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<number> {
    return 0;
  }
  async subscribe(...channels: string[]): Promise<void> {}
  async unsubscribe(...channels: string[]): Promise<void> {}

  // Scripting
  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    return null;
  }
  async evalsha(sha: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    return null;
  }
  async scriptLoad(script: string): Promise<string> {
    return '';
  }
  async scriptExists(...shas: string[]): Promise<number[]> {
    return shas.map(() => 1);
  }

  // Utility
  async flushdb(): Promise<string> {
    return 'OK';
  }
  async flushall(): Promise<string> {
    return 'OK';
  }
  async dbsize(): Promise<number> {
    return 0;
  }
  async info(section?: string): Promise<string> {
    return '';
  }
  async config(operation: string, ...args: string[]): Promise<any> {
    return [];
  }

  // Raw command
  async sendCommand(command: string, ...args: any[]): Promise<any> {
    return null;
  }
}
