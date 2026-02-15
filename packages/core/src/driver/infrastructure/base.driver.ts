import EventEmitter from 'events';

import { Logger } from '@nestjs/common';
import { IRedisDriver, IPipeline, IMulti, ISetOptions, IScanOptions, IStreamAddOptions, IStreamReadOptions, IStreamReadGroupOptions, IStreamEntry, StreamReadResult, IStreamInfo, IStreamPendingInfo, IStreamPendingEntry, DriverEvent, DriverEventHandler, ICopyOptions, IRestoreOptions, ILposOptions, IZStoreOptions, IZRangeByScoreOptions, GeoUnit, IGeoSearchOptions, IGeoSearchResult } from '../../interfaces';
import { DriverError, TimeoutError } from '../../shared/errors';
import { ConnectionConfig } from '../../types';

/**
 * Base Redis driver implementation.
 *
 * Provides common functionality for all driver implementations.
 * Subclasses must implement abstract methods for specific Redis clients.
 *
 * Features:
 * - Event handling
 * - Connection state management
 * - Error wrapping
 * - Optional operation logging
 *
 * @abstract
 */
export abstract class BaseRedisDriver implements IRedisDriver {
  protected readonly eventEmitter: EventEmitter;
  protected readonly logger: Logger;
  protected connected = false;
  protected connecting = false;
  protected readonly enableLogging: boolean;

  constructor(
    protected readonly config: ConnectionConfig,
    options?: {
      enableLogging?: boolean;
    },
  ) {
    this.eventEmitter = new EventEmitter();
    this.logger = new Logger(this.constructor.name);
    this.enableLogging = options?.enableLogging ?? false;
  }

  /**
   * Establishes connection to Redis.
   * Must set `this.connected = true` on success.
   */
  protected abstract doConnect(): Promise<void>;

  /**
   * Closes connection to Redis.
   * Must set `this.connected = false` on completion.
   */
  protected abstract doDisconnect(): Promise<void>;

  /**
   * Executes raw Redis command.
   * @param command - Command name
   * @param args - Command arguments
   */
  protected abstract executeCommand(command: string, ...args: unknown[]): Promise<unknown>;

  /**
   * Creates pipeline instance.
   */
  protected abstract createPipeline(): IPipeline;

  /**
   * Creates multi/exec transaction instance.
   */
  protected abstract createMulti(): IMulti;

  async connect(): Promise<void> {
    if (this.connected) {
      this.log('Already connected, skipping connect');
      return;
    }

    if (this.connecting) {
      this.log('Connection in progress, waiting...');
      return new Promise((resolve, reject) => {
        const onConnect = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error?: unknown): void => {
          cleanup();
          reject(error);
        };
        const cleanup = (): void => {
          this.off(DriverEvent.READY, onConnect);
          this.off(DriverEvent.ERROR, onError);
        };
        this.once(DriverEvent.READY, onConnect);
        this.once(DriverEvent.ERROR, onError);
      });
    }

    try {
      this.connecting = true;
      this.log('Connecting to Redis...');
      this.emit(DriverEvent.CONNECT);

      await this.doConnect();

      this.connected = true;
      this.connecting = false;
      this.log('Connected to Redis');
      this.emit(DriverEvent.READY);
    } catch (error) {
      this.connecting = false;
      this.log('Connection failed', error);
      this.emit(DriverEvent.ERROR, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      this.log('Not connected, skipping disconnect');
      return;
    }

    try {
      this.log('Disconnecting from Redis...');
      this.emit(DriverEvent.DISCONNECT);

      await this.doDisconnect();

      this.connected = false;
      this.log('Disconnected from Redis');
      this.emit(DriverEvent.CLOSE);
    } catch (error) {
      this.log('Disconnect failed', error);
      this.emit(DriverEvent.ERROR, error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async ping(message?: string): Promise<string> {
    this.assertConnected();
    const result = message ? await this.executeCommand('PING', message) : await this.executeCommand('PING');
    return String(result);
  }

  async select(db: number): Promise<void> {
    this.assertConnected();
    await this.executeCommand('SELECT', db);
  }

  async get(key: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('GET', key);
    return result === null || result === undefined ? null : String(result);
  }

  async set(key: string, value: string, options?: ISetOptions): Promise<'OK' | null> {
    this.assertConnected();
    const args: unknown[] = [key, value];

    if (options) {
      if (options.ex !== undefined) {
        args.push('EX', options.ex);
      }
      if (options.px !== undefined) {
        args.push('PX', options.px);
      }
      if (options.exat !== undefined) {
        args.push('EXAT', options.exat);
      }
      if (options.pxat !== undefined) {
        args.push('PXAT', options.pxat);
      }
      if (options.nx) {
        args.push('NX');
      }
      if (options.xx) {
        args.push('XX');
      }
      if (options.get) {
        args.push('GET');
      }
      if (options.keepttl) {
        args.push('KEEPTTL');
      }
    }

    const result = await this.executeCommand('SET', ...args);
    return result === 'OK' ? 'OK' : null;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    this.assertConnected();
    const result = await this.executeCommand('MGET', ...keys);
    return (result as unknown[]).map((v) => (v === null || v === undefined ? null : String(v)));
  }

  async mset(data: Record<string, string>): Promise<'OK'> {
    this.assertConnected();
    const args: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      args.push(key, value);
    }
    await this.executeCommand('MSET', ...args);
    return 'OK';
  }

  async setnx(key: string, value: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SETNX', key, value);
    return Number(result);
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('SETEX', key, seconds, value);
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('GETDEL', key);
    return result === null || result === undefined ? null : String(result);
  }

  async getex(key: string, options: { ex?: number; px?: number }): Promise<string | null> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (options.ex !== undefined) {
      args.push('EX', options.ex);
    }
    if (options.px !== undefined) {
      args.push('PX', options.px);
    }
    const result = await this.executeCommand('GETEX', ...args);
    return result === null || result === undefined ? null : String(result);
  }

  async incr(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('INCR', key);
    return Number(result);
  }

  async incrby(key: string, increment: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('INCRBY', key, increment);
    return Number(result);
  }

  async decr(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('DECR', key);
    return Number(result);
  }

  async decrby(key: string, decrement: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('DECRBY', key, decrement);
    return Number(result);
  }

  async append(key: string, value: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('APPEND', key, value);
    return Number(result);
  }

  async strlen(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('STRLEN', key);
    return Number(result);
  }

  async incrbyfloat(key: string, increment: number): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('INCRBYFLOAT', key, increment);
    return String(result);
  }

  async getrange(key: string, start: number, end: number): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('GETRANGE', key, start, end);
    return String(result);
  }

  async setrange(key: string, offset: number, value: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SETRANGE', key, offset, value);
    return Number(result);
  }

  async msetnx(data: Record<string, string>): Promise<number> {
    this.assertConnected();
    const args: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      args.push(key, value);
    }
    const result = await this.executeCommand('MSETNX', ...args);
    return Number(result);
  }

  async del(...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('DEL', ...keys);
    return Number(result);
  }

  async exists(...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('EXISTS', ...keys);
    return Number(result);
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('EXPIRE', key, seconds);
    return Number(result);
  }

  async pexpire(key: string, milliseconds: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PEXPIRE', key, milliseconds);
    return Number(result);
  }

  async expireat(key: string, timestamp: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('EXPIREAT', key, timestamp);
    return Number(result);
  }

  async ttl(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('TTL', key);
    return Number(result);
  }

  async pttl(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PTTL', key);
    return Number(result);
  }

  async persist(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PERSIST', key);
    return Number(result);
  }

  async rename(key: string, newKey: string): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('RENAME', key, newKey);
    return 'OK';
  }

  async renamenx(key: string, newKey: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('RENAMENX', key, newKey);
    return Number(result);
  }

  async type(key: string): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('TYPE', key);
    return String(result);
  }

  async scan(cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [cursor];
    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    if (options?.type) {
      args.push('TYPE', options.type);
    }
    const result = await this.executeCommand('SCAN', ...args);
    const [newCursor, keys] = result as [string, string[]];
    return [String(newCursor), keys];
  }

  async unlink(...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('UNLINK', ...keys);
    return Number(result);
  }

  async copy(source: string, destination: string, options?: ICopyOptions): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [source, destination];
    if (options?.db !== undefined) {
      args.push('DB', options.db);
    }
    if (options?.replace) {
      args.push('REPLACE');
    }
    const result = await this.executeCommand('COPY', ...args);
    return Number(result);
  }

  async keys(pattern: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('KEYS', pattern);
    return result as string[];
  }

  async touch(...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('TOUCH', ...keys);
    return Number(result);
  }

  async object(subcommand: 'ENCODING' | 'FREQ' | 'IDLETIME' | 'REFCOUNT', key: string): Promise<string | number | null> {
    this.assertConnected();
    const result = await this.executeCommand('OBJECT', subcommand, key);
    if (result === null) return null;
    if (subcommand === 'ENCODING') return String(result);
    return Number(result);
  }

  async dump(key: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('DUMP', key);
    return result === null ? null : String(result);
  }

  async restore(key: string, ttl: number, serializedValue: string, options?: IRestoreOptions): Promise<'OK'> {
    this.assertConnected();
    const args: unknown[] = [key, ttl, serializedValue];
    if (options?.replace) {
      args.push('REPLACE');
    }
    if (options?.absttl) {
      args.push('ABSTTL');
    }
    if (options?.idletime !== undefined) {
      args.push('IDLETIME', options.idletime);
    }
    if (options?.freq !== undefined) {
      args.push('FREQ', options.freq);
    }
    await this.executeCommand('RESTORE', ...args);
    return 'OK';
  }

  async time(): Promise<[string, string]> {
    this.assertConnected();
    const result = await this.executeCommand('TIME');
    const [seconds, microseconds] = result as [string, string];
    return [String(seconds), String(microseconds)];
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('HGET', key, field);
    return result === null || result === undefined ? null : String(result);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HSET', key, field, value);
    return Number(result);
  }

  async hmset(key: string, data: Record<string, string>): Promise<'OK'> {
    this.assertConnected();
    const args: string[] = [key];
    for (const [field, value] of Object.entries(data)) {
      args.push(field, value);
    }
    await this.executeCommand('HMSET', ...args);
    return 'OK';
  }

  async hmget(key: string, ...fields: string[]): Promise<Array<string | null>> {
    this.assertConnected();
    const result = await this.executeCommand('HMGET', key, ...fields);
    return (result as unknown[]).map((v) => (v === null || v === undefined ? null : String(v)));
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.assertConnected();
    const result = await this.executeCommand('HGETALL', key);
    return result as Record<string, string>;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HDEL', key, ...fields);
    return Number(result);
  }

  async hexists(key: string, field: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HEXISTS', key, field);
    return Number(result);
  }

  async hkeys(key: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('HKEYS', key);
    return result as string[];
  }

  async hvals(key: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('HVALS', key);
    return result as string[];
  }

  async hlen(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HLEN', key);
    return Number(result);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HINCRBY', key, field, increment);
    return Number(result);
  }

  async hscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];
    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    const result = await this.executeCommand('HSCAN', ...args);
    const [newCursor, fields] = result as [string, string[]];
    return [String(newCursor), fields];
  }

  async hsetnx(key: string, field: string, value: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HSETNX', key, field, value);
    return Number(result);
  }

  async hincrbyfloat(key: string, field: string, increment: number): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('HINCRBYFLOAT', key, field, increment);
    return String(result);
  }

  async hstrlen(key: string, field: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('HSTRLEN', key, field);
    return Number(result);
  }

  async hrandfield(key: string, count?: number, withValues?: boolean): Promise<string | string[] | null> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
      if (withValues) {
        args.push('WITHVALUES');
      }
    }
    const result = await this.executeCommand('HRANDFIELD', ...args);
    return result as string | string[] | null;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('LPUSH', key, ...values);
    return Number(result);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('RPUSH', key, ...values);
    return Number(result);
  }

  async lpop(key: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('LPOP', key);
    return result === null || result === undefined ? null : String(result);
  }

  async rpop(key: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('RPOP', key);
    return result === null || result === undefined ? null : String(result);
  }

  async llen(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('LLEN', key);
    return Number(result);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('LRANGE', key, start, stop);
    return result as string[];
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('LTRIM', key, start, stop);
    return 'OK';
  }

  async lindex(key: string, index: number): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('LINDEX', key, index);
    return result === null || result === undefined ? null : String(result);
  }

  async lset(key: string, index: number, value: string): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('LSET', key, index, value);
    return 'OK';
  }

  async linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('LINSERT', key, position, pivot, element);
    return Number(result);
  }

  async lrem(key: string, count: number, element: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('LREM', key, count, element);
    return Number(result);
  }

  async lpos(key: string, element: string, options?: ILposOptions): Promise<number | number[] | null> {
    this.assertConnected();
    const args: unknown[] = [key, element];
    if (options?.rank !== undefined) {
      args.push('RANK', options.rank);
    }
    if (options?.count !== undefined) {
      args.push('COUNT', options.count);
    }
    if (options?.maxlen !== undefined) {
      args.push('MAXLEN', options.maxlen);
    }
    const result = await this.executeCommand('LPOS', ...args);
    if (result === null) return null;
    if (Array.isArray(result)) return result.map(Number);
    return Number(result);
  }

  async blpop(keys: string[], timeout: number): Promise<[string, string] | null> {
    this.assertConnected();
    const result = await this.executeCommand('BLPOP', ...keys, timeout);
    if (!result) return null;
    const [key, value] = result as [string, string];
    return [key, value];
  }

  async brpop(keys: string[], timeout: number): Promise<[string, string] | null> {
    this.assertConnected();
    const result = await this.executeCommand('BRPOP', ...keys, timeout);
    if (!result) return null;
    const [key, value] = result as [string, string];
    return [key, value];
  }

  async lmove(source: string, destination: string, from: 'LEFT' | 'RIGHT', to: 'LEFT' | 'RIGHT'): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('LMOVE', source, destination, from, to);
    return result === null ? null : String(result);
  }

  async blmove(source: string, destination: string, from: 'LEFT' | 'RIGHT', to: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('BLMOVE', source, destination, from, to, timeout);
    return result === null ? null : String(result);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SADD', key, ...members);
    return Number(result);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SREM', key, ...members);
    return Number(result);
  }

  async smembers(key: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('SMEMBERS', key);
    return result as string[];
  }

  async sismember(key: string, member: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SISMEMBER', key, member);
    return Number(result);
  }

  async scard(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SCARD', key);
    return Number(result);
  }

  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
    }
    const result = await this.executeCommand('SRANDMEMBER', ...args);
    return result as string | string[] | null;
  }

  async spop(key: string, count?: number): Promise<string | string[] | null> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
    }
    const result = await this.executeCommand('SPOP', ...args);
    return result as string | string[] | null;
  }

  async sscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];
    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    const result = await this.executeCommand('SSCAN', ...args);
    const [newCursor, members] = result as [string, string[]];
    return [String(newCursor), members];
  }

  async smove(source: string, destination: string, member: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SMOVE', source, destination, member);
    return Number(result);
  }

  async sinter(...keys: string[]): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('SINTER', ...keys);
    return result as string[];
  }

  async sinterstore(destination: string, ...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SINTERSTORE', destination, ...keys);
    return Number(result);
  }

  async sunion(...keys: string[]): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('SUNION', ...keys);
    return result as string[];
  }

  async sunionstore(destination: string, ...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SUNIONSTORE', destination, ...keys);
    return Number(result);
  }

  async sdiff(...keys: string[]): Promise<string[]> {
    this.assertConnected();
    const result = await this.executeCommand('SDIFF', ...keys);
    return result as string[];
  }

  async sdiffstore(destination: string, ...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SDIFFSTORE', destination, ...keys);
    return Number(result);
  }

  async smismember(key: string, ...members: string[]): Promise<number[]> {
    this.assertConnected();
    const result = await this.executeCommand('SMISMEMBER', key, ...members);
    return (result as number[]).map(Number);
  }

  async zadd(key: string, ...args: Array<number | string>): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('ZADD', key, ...args);
    return Number(result);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('ZREM', key, ...members);
    return Number(result);
  }

  async zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    this.assertConnected();
    const args: unknown[] = [key, start, stop];
    if (withScores) {
      args.push('WITHSCORES');
    }
    const result = await this.executeCommand('ZRANGE', ...args);
    return result as string[];
  }

  async zrangebyscore(key: string, min: number | string, max: number | string, withScores?: boolean): Promise<string[]> {
    this.assertConnected();
    const args: unknown[] = [key, min, max];
    if (withScores) {
      args.push('WITHSCORES');
    }
    const result = await this.executeCommand('ZRANGEBYSCORE', ...args);
    return result as string[];
  }

  async zscore(key: string, member: string): Promise<string | null> {
    this.assertConnected();
    const result = await this.executeCommand('ZSCORE', key, member);
    return result === null || result === undefined ? null : String(result);
  }

  async zcard(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('ZCARD', key);
    return Number(result);
  }

  async zrank(key: string, member: string): Promise<number | null> {
    this.assertConnected();
    const result = await this.executeCommand('ZRANK', key, member);
    return result === null || result === undefined ? null : Number(result);
  }

  async zincrby(key: string, increment: number, member: string): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('ZINCRBY', key, increment, member);
    return String(result);
  }

  async zscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];
    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    const result = await this.executeCommand('ZSCAN', ...args);
    const [newCursor, members] = result as [string, string[]];
    return [String(newCursor), members];
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    this.assertConnected();
    const result = await this.executeCommand('ZREVRANK', key, member);
    return result === null || result === undefined ? null : Number(result);
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('ZCOUNT', key, min, max);
    return Number(result);
  }

  async zlexcount(key: string, min: string, max: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('ZLEXCOUNT', key, min, max);
    return Number(result);
  }

  async zpopmin(key: string, count?: number): Promise<string[]> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
    }
    const result = await this.executeCommand('ZPOPMIN', ...args);
    return result as string[];
  }

  async zpopmax(key: string, count?: number): Promise<string[]> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
    }
    const result = await this.executeCommand('ZPOPMAX', ...args);
    return result as string[];
  }

  async bzpopmin(keys: string[], timeout: number): Promise<[string, string, string] | null> {
    this.assertConnected();
    const result = await this.executeCommand('BZPOPMIN', ...keys, timeout);
    if (!result) return null;
    const [key, member, score] = result as [string, string, string];
    return [key, member, String(score)];
  }

  async bzpopmax(keys: string[], timeout: number): Promise<[string, string, string] | null> {
    this.assertConnected();
    const result = await this.executeCommand('BZPOPMAX', ...keys, timeout);
    if (!result) return null;
    const [key, member, score] = result as [string, string, string];
    return [key, member, String(score)];
  }

  async zunionstore(destination: string, keys: string[], options?: IZStoreOptions): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [destination, keys.length, ...keys];
    if (options?.weights) {
      args.push('WEIGHTS', ...options.weights);
    }
    if (options?.aggregate) {
      args.push('AGGREGATE', options.aggregate);
    }
    const result = await this.executeCommand('ZUNIONSTORE', ...args);
    return Number(result);
  }

  async zinterstore(destination: string, keys: string[], options?: IZStoreOptions): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [destination, keys.length, ...keys];
    if (options?.weights) {
      args.push('WEIGHTS', ...options.weights);
    }
    if (options?.aggregate) {
      args.push('AGGREGATE', options.aggregate);
    }
    const result = await this.executeCommand('ZINTERSTORE', ...args);
    return Number(result);
  }

  async zmscore(key: string, ...members: string[]): Promise<Array<string | null>> {
    this.assertConnected();
    const result = await this.executeCommand('ZMSCORE', key, ...members);
    return (result as unknown[]).map((v) => (v === null || v === undefined ? null : String(v)));
  }

  async zrandmember(key: string, count?: number, withScores?: boolean): Promise<string | string[] | null> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (count !== undefined) {
      args.push(count);
      if (withScores) {
        args.push('WITHSCORES');
      }
    }
    const result = await this.executeCommand('ZRANDMEMBER', ...args);
    return result as string | string[] | null;
  }

  async zrevrangebyscore(key: string, max: number | string, min: number | string, options?: IZRangeByScoreOptions): Promise<string[]> {
    this.assertConnected();
    const args: unknown[] = [key, max, min];
    if (options?.withScores) {
      args.push('WITHSCORES');
    }
    if (options?.limit) {
      args.push('LIMIT', options.limit.offset, options.limit.count);
    }
    const result = await this.executeCommand('ZREVRANGEBYSCORE', ...args);
    return result as string[];
  }

  async publish(channel: string, message: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PUBLISH', channel, message);
    return Number(result);
  }

  async subscribe(...channels: string[]): Promise<void> {
    this.assertConnected();
    await this.executeCommand('SUBSCRIBE', ...channels);
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    this.assertConnected();
    await this.executeCommand('UNSUBSCRIBE', ...channels);
  }

  async psubscribe(...patterns: string[]): Promise<void> {
    this.assertConnected();
    await this.executeCommand('PSUBSCRIBE', ...patterns);
  }

  async punsubscribe(...patterns: string[]): Promise<void> {
    this.assertConnected();
    await this.executeCommand('PUNSUBSCRIBE', ...patterns);
  }

  async xadd(key: string, id: string, fields: Record<string, string>, options?: IStreamAddOptions): Promise<string> {
    this.assertConnected();
    const args: unknown[] = [key];

    // Add options before ID
    if (options?.noMkStream) {
      args.push('NOMKSTREAM');
    }
    if (options?.maxLen !== undefined) {
      args.push('MAXLEN');
      if (options.approximate) {
        args.push('~');
      }
      args.push(options.maxLen);
    }
    if (options?.minId !== undefined) {
      args.push('MINID');
      if (options.approximate) {
        args.push('~');
      }
      args.push(options.minId);
    }

    args.push(id);

    // Add fields
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, value);
    }

    const result = await this.executeCommand('XADD', ...args);
    return String(result);
  }

  async xread(streams: Array<{ key: string; id: string }>, options?: IStreamReadOptions): Promise<StreamReadResult | null> {
    this.assertConnected();
    const args: unknown[] = [];

    if (options?.count !== undefined) {
      args.push('COUNT', options.count);
    }
    if (options?.block !== undefined) {
      args.push('BLOCK', options.block);
    }

    args.push('STREAMS');
    for (const stream of streams) {
      args.push(stream.key);
    }
    for (const stream of streams) {
      args.push(stream.id);
    }

    const result = await this.executeCommand('XREAD', ...args);
    if (!result) return null;

    return this.parseStreamReadResult(result as unknown[]);
  }

  async xreadgroup(group: string, consumer: string, streams: Array<{ key: string; id: string }>, options?: IStreamReadGroupOptions): Promise<StreamReadResult | null> {
    this.assertConnected();
    const args: unknown[] = ['GROUP', group, consumer];

    if (options?.count !== undefined) {
      args.push('COUNT', options.count);
    }
    if (options?.block !== undefined) {
      args.push('BLOCK', options.block);
    }
    if (options?.noAck) {
      args.push('NOACK');
    }

    args.push('STREAMS');
    for (const stream of streams) {
      args.push(stream.key);
    }
    for (const stream of streams) {
      args.push(stream.id);
    }

    const result = await this.executeCommand('XREADGROUP', ...args);
    if (!result) return null;

    return this.parseStreamReadResult(result as unknown[]);
  }

  async xrange(key: string, start: string, end: string, options?: { count?: number }): Promise<IStreamEntry[]> {
    this.assertConnected();
    const args: unknown[] = [key, start, end];

    if (options?.count !== undefined) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('XRANGE', ...args);
    return this.parseStreamEntries(result as unknown[]);
  }

  async xrevrange(key: string, end: string, start: string, options?: { count?: number }): Promise<IStreamEntry[]> {
    this.assertConnected();
    const args: unknown[] = [key, end, start];

    if (options?.count !== undefined) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('XREVRANGE', ...args);
    return this.parseStreamEntries(result as unknown[]);
  }

  async xlen(key: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('XLEN', key);
    return Number(result);
  }

  async xinfo(key: string): Promise<IStreamInfo> {
    this.assertConnected();
    const result = await this.executeCommand('XINFO', 'STREAM', key);
    return this.parseIStreamInfo(result as unknown[]);
  }

  async xtrim(key: string, maxLen: number, approximate?: boolean): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [key, 'MAXLEN'];
    if (approximate) {
      args.push('~');
    }
    args.push(maxLen);

    const result = await this.executeCommand('XTRIM', ...args);
    return Number(result);
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<'OK'> {
    this.assertConnected();
    const args: unknown[] = [key, group, id];
    if (mkstream) {
      args.push('MKSTREAM');
    }

    await this.executeCommand('XGROUP', 'CREATE', ...args);
    return 'OK';
  }

  async xgroupDestroy(key: string, group: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('XGROUP', 'DESTROY', key, group);
    return Number(result);
  }

  async xgroupDelConsumer(key: string, group: string, consumer: string): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('XGROUP', 'DELCONSUMER', key, group, consumer);
    return Number(result);
  }

  async xgroupSetId(key: string, group: string, id: string): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('XGROUP', 'SETID', key, group, id);
    return 'OK';
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('XACK', key, group, ...ids);
    return Number(result);
  }

  async xpending(key: string, group: string): Promise<IStreamPendingInfo> {
    this.assertConnected();
    const result = await this.executeCommand('XPENDING', key, group);
    return this.parseIStreamPendingInfo(result as unknown[]);
  }

  async xpendingRange(key: string, group: string, start: string, end: string, count: number, consumer?: string): Promise<IStreamPendingEntry[]> {
    this.assertConnected();
    const args: unknown[] = [key, group, start, end, count];
    if (consumer) {
      args.push(consumer);
    }

    const result = await this.executeCommand('XPENDING', ...args);
    return this.parseStreamPendingEntries(result as unknown[]);
  }

  async xclaim(key: string, group: string, consumer: string, minIdleTime: number, ...ids: string[]): Promise<IStreamEntry[]> {
    this.assertConnected();
    const result = await this.executeCommand('XCLAIM', key, group, consumer, minIdleTime, ...ids);
    return this.parseStreamEntries(result as unknown[]);
  }

  async xdel(key: string, ...ids: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('XDEL', key, ...ids);
    return Number(result);
  }

  private parseStreamReadResult(result: unknown[]): StreamReadResult {
    return result.map((streamData) => {
      const [key, entries] = streamData as [string, unknown[]];
      return {
        key,
        entries: this.parseStreamEntries(entries),
      };
    });
  }

  private parseStreamEntries(entries: unknown[]): IStreamEntry[] {
    return entries.map((entry) => {
      const [id, fields] = entry as [string, string[]];
      return {
        id,
        fields: this.parseFieldArray(fields),
      };
    });
  }

  private parseFieldArray(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      if (key !== undefined && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private parseIStreamInfo(result: unknown[]): IStreamInfo {
    const info: Record<string, unknown> = {};
    for (let i = 0; i < result.length; i += 2) {
      const key = String(result[i]).toLowerCase().replace(/-/g, '');
      info[key] = result[i + 1];
    }

    return {
      length: Number(info['length'] ?? 0),
      groups: Number(info['groups'] ?? 0),
      firstEntry: info['firstentry'] ? (this.parseStreamEntries([info['firstentry']])[0] ?? null) : null,
      lastEntry: info['lastentry'] ? (this.parseStreamEntries([info['lastentry']])[0] ?? null) : null,
      lastGeneratedId: String(info['lastgeneratedid'] ?? '0-0'),
      radixTreeKeys: Number(info['radixtreekeys'] ?? 0),
      radixTreeNodes: Number(info['radixtreenodes'] ?? 0),
    };
  }

  private parseIStreamPendingInfo(result: unknown[]): IStreamPendingInfo {
    const [count, minId, maxId, consumers] = result as [number, string | null, string | null, unknown[] | null];
    return {
      count: Number(count),
      minId,
      maxId,
      consumers: consumers
        ? consumers.map((c) => {
            const [name, pending] = c as [string, string];
            return { name, count: Number(pending) };
          })
        : [],
    };
  }

  private parseStreamPendingEntries(result: unknown[]): IStreamPendingEntry[] {
    return result.map((entry) => {
      const [id, consumer, idleTime, deliveryCount] = entry as [string, string, number, number];
      return {
        id,
        consumer,
        idleTime: Number(idleTime),
        deliveryCount: Number(deliveryCount),
      };
    });
  }

  pipeline(): IPipeline {
    this.assertConnected();
    return this.createPipeline();
  }

  multi(): IMulti {
    this.assertConnected();
    return this.createMulti();
  }

  /** Registry mapping SHA → script source for NOSCRIPT fallback */
  private readonly scriptRegistry = new Map<string, string>();

  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    this.assertConnected();
    const result = await this.executeCommand('EVAL', script, keys.length, ...keys, ...args);
    return result;
  }

  async evalsha(sha: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    this.assertConnected();
    try {
      return await this.executeCommand('EVALSHA', sha, keys.length, ...keys, ...args);
    } catch (error) {
      if (this.isNoscriptError(error)) {
        const script = this.scriptRegistry.get(sha);
        if (script) {
          return this.eval(script, keys, args);
        }
      }
      throw error;
    }
  }

  async scriptLoad(script: string): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('SCRIPT', 'LOAD', script);
    const sha = String(result);
    this.scriptRegistry.set(sha, script);
    return sha;
  }

  private isNoscriptError(error: unknown): boolean {
    const msg = (error as Error)?.message ?? '';
    return msg.includes('NOSCRIPT');
  }

  async scriptExists(...shas: string[]): Promise<number[]> {
    this.assertConnected();
    const result = await this.executeCommand('SCRIPT', 'EXISTS', ...shas);
    return (result as number[]).map(Number);
  }

  async scriptFlush(): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('SCRIPT', 'FLUSH');
    return 'OK';
  }

  async pfadd(key: string, ...elements: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PFADD', key, ...elements);
    return Number(result);
  }

  async pfcount(...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('PFCOUNT', ...keys);
    return Number(result);
  }

  async pfmerge(destination: string, ...sources: string[]): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('PFMERGE', destination, ...sources);
    return 'OK';
  }

  async geoadd(key: string, ...members: Array<number | string>): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('GEOADD', key, ...members);
    return Number(result);
  }

  async geodist(key: string, member1: string, member2: string, unit?: GeoUnit): Promise<string | null> {
    this.assertConnected();
    const args: unknown[] = [key, member1, member2];
    if (unit) {
      args.push(unit);
    }
    const result = await this.executeCommand('GEODIST', ...args);
    return result === null ? null : String(result);
  }

  async geohash(key: string, ...members: string[]): Promise<Array<string | null>> {
    this.assertConnected();
    const result = await this.executeCommand('GEOHASH', key, ...members);
    return (result as unknown[]).map((v) => (v === null ? null : String(v)));
  }

  async geopos(key: string, ...members: string[]): Promise<Array<[string, string] | null>> {
    this.assertConnected();
    const result = await this.executeCommand('GEOPOS', key, ...members);
    return (result as Array<[string, string] | null>).map((pos) => {
      if (!pos) return null;
      return [String(pos[0]), String(pos[1])];
    });
  }

  async geosearch(key: string, options: IGeoSearchOptions): Promise<Array<string | IGeoSearchResult>> {
    this.assertConnected();
    const args: unknown[] = [key];

    // From member or coordinates
    if (options.member) {
      args.push('FROMMEMBER', options.member);
    } else if (options.coord) {
      args.push('FROMLONLAT', options.coord.longitude, options.coord.latitude);
    }

    // By radius or box
    if (options.radius) {
      args.push('BYRADIUS', options.radius.value, options.radius.unit);
    } else if (options.box) {
      args.push('BYBOX', options.box.width, options.box.height, options.box.unit);
    }

    // Optional parameters
    if (options.sort) {
      args.push(options.sort);
    }
    if (options.count !== undefined) {
      args.push('COUNT', options.count);
      if (options.any) {
        args.push('ANY');
      }
    }
    if (options.withCoord) {
      args.push('WITHCOORD');
    }
    if (options.withDist) {
      args.push('WITHDIST');
    }
    if (options.withHash) {
      args.push('WITHHASH');
    }

    const result = await this.executeCommand('GEOSEARCH', ...args);
    return this.parseIGeoSearchResult(result as unknown[], options);
  }

  async geosearchstore(destination: string, source: string, options: IGeoSearchOptions & { storedist?: boolean }): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [destination, source];

    // From member or coordinates
    if (options.member) {
      args.push('FROMMEMBER', options.member);
    } else if (options.coord) {
      args.push('FROMLONLAT', options.coord.longitude, options.coord.latitude);
    }

    // By radius or box
    if (options.radius) {
      args.push('BYRADIUS', options.radius.value, options.radius.unit);
    } else if (options.box) {
      args.push('BYBOX', options.box.width, options.box.height, options.box.unit);
    }

    // Optional parameters
    if (options.sort) {
      args.push(options.sort);
    }
    if (options.count !== undefined) {
      args.push('COUNT', options.count);
      if (options.any) {
        args.push('ANY');
      }
    }
    if (options.storedist) {
      args.push('STOREDIST');
    }

    const result = await this.executeCommand('GEOSEARCHSTORE', ...args);
    return Number(result);
  }

  private parseIGeoSearchResult(result: unknown[], options: IGeoSearchOptions): Array<string | IGeoSearchResult> {
    const hasExtra = options.withCoord || options.withDist || options.withHash;
    if (!hasExtra) {
      return result as string[];
    }

    return result.map((item) => {
      if (!Array.isArray(item)) {
        return item as string;
      }

      const geoResult: IGeoSearchResult = { member: String(item[0]) };
      let idx = 1;

      if (options.withDist && item[idx] !== undefined) {
        geoResult.distance = String(item[idx]);
        idx++;
      }
      if (options.withHash && item[idx] !== undefined) {
        geoResult.hash = Number(item[idx]);
        idx++;
      }
      if (options.withCoord && item[idx] !== undefined) {
        const coords = item[idx] as [string, string];
        geoResult.coordinates = [String(coords[0]), String(coords[1])];
      }

      return geoResult;
    });
  }

  async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('SETBIT', key, offset, value);
    return Number(result);
  }

  async getbit(key: string, offset: number): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('GETBIT', key, offset);
    return Number(result);
  }

  async bitcount(key: string, start?: number, end?: number, mode?: 'BYTE' | 'BIT'): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [key];
    if (start !== undefined && end !== undefined) {
      args.push(start, end);
      if (mode) {
        args.push(mode);
      }
    }
    const result = await this.executeCommand('BITCOUNT', ...args);
    return Number(result);
  }

  async bitop(operation: 'AND' | 'OR' | 'XOR' | 'NOT', destKey: string, ...keys: string[]): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('BITOP', operation, destKey, ...keys);
    return Number(result);
  }

  async bitpos(key: string, bit: 0 | 1, start?: number, end?: number, mode?: 'BYTE' | 'BIT'): Promise<number> {
    this.assertConnected();
    const args: unknown[] = [key, bit];
    if (start !== undefined) {
      args.push(start);
      if (end !== undefined) {
        args.push(end);
        if (mode) {
          args.push(mode);
        }
      }
    }
    const result = await this.executeCommand('BITPOS', ...args);
    return Number(result);
  }

  async flushdb(): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('FLUSHDB');
    return 'OK';
  }

  async flushall(): Promise<'OK'> {
    this.assertConnected();
    await this.executeCommand('FLUSHALL');
    return 'OK';
  }

  async info(section?: string): Promise<string> {
    this.assertConnected();
    const args: string[] = section ? [section] : [];
    const result = await this.executeCommand('INFO', ...args);
    return String(result);
  }

  async dbsize(): Promise<number> {
    this.assertConnected();
    const result = await this.executeCommand('DBSIZE');
    return Number(result);
  }

  async cluster(subcommand: string, ...args: Array<string | number>): Promise<unknown> {
    this.assertConnected();
    return this.executeCommand('CLUSTER', subcommand, ...args);
  }

  async sentinel(subcommand: string, ...args: Array<string | number>): Promise<unknown> {
    this.assertConnected();
    return this.executeCommand('SENTINEL', subcommand, ...args);
  }

  on(event: DriverEvent, handler: DriverEventHandler): void {
    this.eventEmitter.on(event, handler);
  }

  once(event: DriverEvent, handler: DriverEventHandler): void {
    this.eventEmitter.once(event, handler);
  }

  off(event: DriverEvent, handler: DriverEventHandler): void {
    this.eventEmitter.off(event, handler);
  }

  removeAllListeners(event?: DriverEvent): void {
    if (event) {
      this.eventEmitter.removeAllListeners(event);
    } else {
      this.eventEmitter.removeAllListeners();
    }
  }

  /**
   * Asserts that driver is connected.
   * @throws DriverError if not connected
   */
  protected assertConnected(): void {
    if (!this.connected) {
      throw new DriverError('Driver is not connected. Call connect() first.', 'DRIVER_NOT_CONNECTED' as never);
    }
  }

  /**
   * Emits driver event.
   */
  protected emit(event: DriverEvent, data?: unknown): void {
    this.eventEmitter.emit(event, data);
  }

  /**
   * Logs message if logging is enabled.
   */
  protected log(message: string, data?: unknown): void {
    if (this.enableLogging) {
      if (data) {
        this.logger.debug(`${message} ${JSON.stringify(data)}`);
      } else {
        this.logger.debug(message);
      }
    }
  }

  /**
   * Wraps execution with timeout.
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs))]);
  }
}
