import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';

import { RedisClientManager } from '../client';
import { IRedisDriver, ISetOptions, IScanOptions, IPipeline, IMulti } from '../interfaces';
import { CLIENT_MANAGER, DEFAULT_CLIENT_NAME } from '../shared/constants';

/**
 * Redis service - convenient wrapper over RedisClientManager.
 *
 * Provides direct access to Redis operations without manual client management.
 * All methods are proxied to the default Redis driver.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(private readonly redis: RedisService) {}
 *
 *   async cacheUser(id: string, user: User): Promise<void> {
 *     await this.redis.set(`user:${id}`, JSON.stringify(user), { ex: 3600 });
 *   }
 *
 *   async getUser(id: string): Promise<User | null> {
 *     const data = await this.redis.get(`user:${id}`);
 *     return data ? JSON.parse(data) : null;
 *   }
 *
 *   async deleteUser(id: string): Promise<void> {
 *     await this.redis.del(`user:${id}`);
 *   }
 * }
 * ```
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  /**
   * Default Redis driver instance.
   */
  private driver: IRedisDriver | null = null;

  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  /**
   * Gets default Redis driver.
   * Lazy loads on first access.
   */
  private async getDriver(): Promise<IRedisDriver> {
    if (!this.driver) {
      this.driver = await this.clientManager.getClient(DEFAULT_CLIENT_NAME);
    }
    return this.driver;
  }

  /**
   * Gets a named Redis client.
   *
   * @param name - Client name
   * @returns Redis driver instance
   *
   * @example
   * ```typescript
   * const sessions = await this.redis.getClient('sessions');
   * await sessions.set('session:123', data);
   * ```
   */
  async getClient(name: string = DEFAULT_CLIENT_NAME): Promise<IRedisDriver> {
    return this.clientManager.getClient(name);
  }

  /**
   * Checks if default client is connected.
   */
  async isConnected(): Promise<boolean> {
    const driver = await this.getDriver();
    return driver.isConnected();
  }

  /**
   * Pings Redis server.
   */
  async ping(message?: string): Promise<string> {
    const driver = await this.getDriver();
    return driver.ping(message);
  }

  /**
   * Selects database.
   */
  async select(db: number): Promise<void> {
    const driver = await this.getDriver();
    return driver.select(db);
  }

  /**
   * Gets value by key.
   */
  async get(key: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.get(key);
  }

  /**
   * Sets key-value pair with optional TTL.
   */
  async set(key: string, value: string, options?: ISetOptions): Promise<'OK' | null> {
    const driver = await this.getDriver();
    return driver.set(key, value, options);
  }

  /**
   * Gets multiple values.
   */
  async mget(...keys: string[]): Promise<Array<string | null>> {
    const driver = await this.getDriver();
    return driver.mget(...keys);
  }

  /**
   * Sets multiple key-value pairs.
   */
  async mset(data: Record<string, string>): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.mset(data);
  }

  /**
   * Sets value only if key doesn't exist.
   */
  async setnx(key: string, value: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.setnx(key, value);
  }

  /**
   * Sets value with expiration in seconds.
   */
  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.setex(key, seconds, value);
  }

  /**
   * Gets value and deletes key.
   */
  async getdel(key: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.getdel(key);
  }

  /**
   * Gets value and sets expiration.
   */
  async getex(key: string, options: { ex?: number; px?: number }): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.getex(key, options);
  }

  /**
   * Increments integer value by 1.
   */
  async incr(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.incr(key);
  }

  /**
   * Increments integer value by amount.
   */
  async incrby(key: string, increment: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.incrby(key, increment);
  }

  /**
   * Decrements integer value by 1.
   */
  async decr(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.decr(key);
  }

  /**
   * Decrements integer value by amount.
   */
  async decrby(key: string, decrement: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.decrby(key, decrement);
  }

  /**
   * Appends value to key.
   */
  async append(key: string, value: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.append(key, value);
  }

  /**
   * Deletes one or more keys.
   */
  async del(...keys: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.del(...keys);
  }

  /**
   * Checks if keys exist.
   */
  async exists(...keys: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.exists(...keys);
  }

  /**
   * Sets TTL on key (seconds).
   */
  async expire(key: string, seconds: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.expire(key, seconds);
  }

  /**
   * Sets TTL on key (milliseconds).
   */
  async pexpire(key: string, milliseconds: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.pexpire(key, milliseconds);
  }

  /**
   * Sets absolute expiration time.
   */
  async expireat(key: string, timestamp: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.expireat(key, timestamp);
  }

  /**
   * Gets TTL of key (seconds).
   */
  async ttl(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.ttl(key);
  }

  /**
   * Gets TTL of key (milliseconds).
   */
  async pttl(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.pttl(key);
  }

  /**
   * Removes expiration from key.
   */
  async persist(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.persist(key);
  }

  /**
   * Renames key.
   */
  async rename(key: string, newKey: string): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.rename(key, newKey);
  }

  /**
   * Renames key only if new key doesn't exist.
   */
  async renamenx(key: string, newKey: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.renamenx(key, newKey);
  }

  /**
   * Gets type of value stored at key.
   */
  async type(key: string): Promise<string> {
    const driver = await this.getDriver();
    return driver.type(key);
  }

  /**
   * Scans keys matching pattern.
   */
  async scan(cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    const driver = await this.getDriver();
    return driver.scan(cursor, options);
  }

  /**
   * Gets hash field value.
   */
  async hget(key: string, field: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.hget(key, field);
  }

  /**
   * Sets hash field value.
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.hset(key, field, value);
  }

  /**
   * Sets multiple hash fields.
   */
  async hmset(key: string, data: Record<string, string>): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.hmset(key, data);
  }

  /**
   * Gets multiple hash field values.
   */
  async hmget(key: string, ...fields: string[]): Promise<Array<string | null>> {
    const driver = await this.getDriver();
    return driver.hmget(key, ...fields);
  }

  /**
   * Gets all fields and values of hash.
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const driver = await this.getDriver();
    return driver.hgetall(key);
  }

  /**
   * Deletes hash fields.
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.hdel(key, ...fields);
  }

  /**
   * Checks if hash field exists.
   */
  async hexists(key: string, field: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.hexists(key, field);
  }

  /**
   * Gets all field names in hash.
   */
  async hkeys(key: string): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.hkeys(key);
  }

  /**
   * Gets all values in hash.
   */
  async hvals(key: string): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.hvals(key);
  }

  /**
   * Gets number of fields in hash.
   */
  async hlen(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.hlen(key);
  }

  /**
   * Increments hash field by integer.
   */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const driver = await this.getDriver();
    return driver.hincrby(key, field, increment);
  }

  /**
   * Scans hash fields.
   */
  async hscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    const driver = await this.getDriver();
    return driver.hscan(key, cursor, options);
  }

  /**
   * Pushes values to left of list.
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.lpush(key, ...values);
  }

  /**
   * Pushes values to right of list.
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.rpush(key, ...values);
  }

  /**
   * Pops value from left of list.
   */
  async lpop(key: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.lpop(key);
  }

  /**
   * Pops value from right of list.
   */
  async rpop(key: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.rpop(key);
  }

  /**
   * Gets list length.
   */
  async llen(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.llen(key);
  }

  /**
   * Gets list range.
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.lrange(key, start, stop);
  }

  /**
   * Trims list to specified range.
   */
  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.ltrim(key, start, stop);
  }

  /**
   * Gets element at index.
   */
  async lindex(key: string, index: number): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.lindex(key, index);
  }

  /**
   * Sets element at index.
   */
  async lset(key: string, index: number, value: string): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.lset(key, index, value);
  }

  /**
   * Adds members to set.
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.sadd(key, ...members);
  }

  /**
   * Removes members from set.
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.srem(key, ...members);
  }

  /**
   * Gets all members of set.
   */
  async smembers(key: string): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.smembers(key);
  }

  /**
   * Checks if member is in set.
   */
  async sismember(key: string, member: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.sismember(key, member);
  }

  /**
   * Gets number of members in set.
   */
  async scard(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.scard(key);
  }

  /**
   * Gets random member from set.
   */
  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    const driver = await this.getDriver();
    return driver.srandmember(key, count);
  }

  /**
   * Pops random member from set.
   */
  async spop(key: string, count?: number): Promise<string | string[] | null> {
    const driver = await this.getDriver();
    return driver.spop(key, count);
  }

  /**
   * Scans set members.
   */
  async sscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    const driver = await this.getDriver();
    return driver.sscan(key, cursor, options);
  }

  /**
   * Adds members to sorted set with scores.
   */
  async zadd(key: string, ...args: Array<number | string>): Promise<number> {
    const driver = await this.getDriver();
    return driver.zadd(key, ...args);
  }

  /**
   * Removes members from sorted set.
   */
  async zrem(key: string, ...members: string[]): Promise<number> {
    const driver = await this.getDriver();
    return driver.zrem(key, ...members);
  }

  /**
   * Gets members in range by index.
   */
  async zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.zrange(key, start, stop, withScores);
  }

  /**
   * Gets members in range by score.
   */
  async zrangebyscore(key: string, min: number | string, max: number | string, withScores?: boolean): Promise<string[]> {
    const driver = await this.getDriver();
    return driver.zrangebyscore(key, min, max, withScores);
  }

  /**
   * Gets score of member.
   */
  async zscore(key: string, member: string): Promise<string | null> {
    const driver = await this.getDriver();
    return driver.zscore(key, member);
  }

  /**
   * Gets number of members in sorted set.
   */
  async zcard(key: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.zcard(key);
  }

  /**
   * Gets rank of member.
   */
  async zrank(key: string, member: string): Promise<number | null> {
    const driver = await this.getDriver();
    return driver.zrank(key, member);
  }

  /**
   * Increments score of member.
   */
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    const driver = await this.getDriver();
    return driver.zincrby(key, increment, member);
  }

  /**
   * Scans sorted set members.
   */
  async zscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]> {
    const driver = await this.getDriver();
    return driver.zscan(key, cursor, options);
  }

  /**
   * Publishes message to channel.
   */
  async publish(channel: string, message: string): Promise<number> {
    const driver = await this.getDriver();
    return driver.publish(channel, message);
  }

  /**
   * Subscribes to channels.
   */
  async subscribe(...channels: string[]): Promise<void> {
    const driver = await this.getDriver();
    return driver.subscribe(...channels);
  }

  /**
   * Unsubscribes from channels.
   */
  async unsubscribe(...channels: string[]): Promise<void> {
    const driver = await this.getDriver();
    return driver.unsubscribe(...channels);
  }

  /**
   * Subscribes to channels by pattern.
   */
  async psubscribe(...patterns: string[]): Promise<void> {
    const driver = await this.getDriver();
    return driver.psubscribe(...patterns);
  }

  /**
   * Unsubscribes from channel patterns.
   */
  async punsubscribe(...patterns: string[]): Promise<void> {
    const driver = await this.getDriver();
    return driver.punsubscribe(...patterns);
  }

  /**
   * Creates a pipeline for batching commands.
   */
  async pipeline(): Promise<IPipeline> {
    const driver = await this.getDriver();
    return driver.pipeline();
  }

  /**
   * Creates a multi/exec transaction.
   */
  async multi(): Promise<IMulti> {
    const driver = await this.getDriver();
    return driver.multi();
  }

  /**
   * Evaluates Lua script.
   */
  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    const driver = await this.getDriver();
    return driver.eval(script, keys, args);
  }

  /**
   * Evaluates Lua script by SHA.
   */
  async evalsha(sha: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    const driver = await this.getDriver();
    return driver.evalsha(sha, keys, args);
  }

  /**
   * Loads Lua script and returns SHA.
   */
  async scriptLoad(script: string): Promise<string> {
    const driver = await this.getDriver();
    return driver.scriptLoad(script);
  }

  /**
   * Checks if scripts exist.
   */
  async scriptExists(...shas: string[]): Promise<number[]> {
    const driver = await this.getDriver();
    return driver.scriptExists(...shas);
  }

  /**
   * Flushes all scripts from cache.
   */
  async scriptFlush(): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.scriptFlush();
  }

  /**
   * Flushes all keys from current database.
   */
  async flushdb(): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.flushdb();
  }

  /**
   * Flushes all keys from all databases.
   */
  async flushall(): Promise<'OK'> {
    const driver = await this.getDriver();
    return driver.flushall();
  }

  /**
   * Gets server info.
   */
  async info(section?: string): Promise<string> {
    const driver = await this.getDriver();
    return driver.info(section);
  }

  /**
   * Gets database size (number of keys).
   */
  async dbsize(): Promise<number> {
    const driver = await this.getDriver();
    return driver.dbsize();
  }

  /**
   * NestJS lifecycle hook - cleanup on module destroy.
   */
  async onModuleDestroy(): Promise<void> {
    await this.clientManager.closeAll();
  }
}
