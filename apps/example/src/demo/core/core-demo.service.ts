/**
 * @fileoverview Service demonstrating basic Redis operations.
 */

import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class CoreDemoService {
  constructor(private readonly redis: RedisService) {}


  /**
   * Redis connection health check.
   *
   * @returns Redis connection status
   */
  async healthCheck() {
    try {
      const pong = await this.redis.ping();
      const isConnected = await this.redis.isConnected();

      return {
        status: 'ok',
        redis: {
          pong,
          connected: isConnected,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        redis: { connected: false, error: (error as Error).message },
      };
    }
  }

  /**
   * PING the Redis server.
   *
   * @returns PONG response
   */
  async ping() {
    const start = Date.now();
    const response = await this.redis.ping('Hello');
    return { response, latency: Date.now() - start };
  }


  /**
   * SET - set a key's value.
   *
   * @param key - Key
   * @param value - Value
   * @param ttl - Time to live in seconds (optional)
   * @returns Operation result
   */
  async set(key: string, value: string, ttl?: number) {
    if (ttl) {
      await this.redis.setex(key, ttl, value);
    } else {
      await this.redis.set(key, value);
    }
    return { success: true, key, ttl };
  }

  /**
   * GET - get a key's value.
   *
   * @param key - Key
   * @returns Value
   */
  async get(key: string) {
    const value = await this.redis.get(key);
    return { key, value, exists: value !== null };
  }

  /**
   * DEL - delete a key.
   *
   * @param key - Key
   * @returns Number of deleted keys
   */
  async del(key: string) {
    const deleted = await this.redis.del(key);
    return { deleted };
  }

  /**
   * MSET - set multiple keys.
   *
   * @param entries - Object with keys and values
   * @returns Operation result
   */
  async mset(entries: Record<string, string>) {
    await this.redis.mset(entries);
    return { success: true, count: Object.keys(entries).length };
  }

  /**
   * MGET - get multiple keys.
   *
   * @param keys - Array of keys
   * @returns Array of values with metadata
   */
  async mget(keys: string[]) {
    const values = await this.redis.mget(...keys);
    return keys.map((key, i) => ({
      key,
      value: values[i],
      exists: values[i] !== null,
    }));
  }

  /**
   * INCR - increment a value.
   *
   * @param key - Key
   * @returns New value
   */
  async incr(key: string) {
    const value = await this.redis.incr(key);
    return { key, value };
  }

  /**
   * DECR - decrement a value.
   *
   * @param key - Key
   * @returns New value
   */
  async decr(key: string) {
    const value = await this.redis.decr(key);
    return { key, value };
  }

  /**
   * EXISTS - check if keys exist.
   *
   * @param keys - Array of keys to check
   * @returns Number of existing keys
   */
  async exists(keys: string[]) {
    const count = await this.redis.exists(...keys);
    return { count, checked: keys.length };
  }

  /**
   * APPEND - append a string to a value.
   *
   * @param key - Key
   * @param value - Value to append
   * @returns New string length
   */
  async append(key: string, value: string) {
    const length = await this.redis.append(key, value);
    return { key, length };
  }

  /**
   * SETNX - set a value only if the key does not exist.
   *
   * @param key - Key
   * @param value - Value
   * @returns 1 if set, 0 if the key already exists
   */
  async setnx(key: string, value: string) {
    const result = await this.redis.setnx(key, value);
    return { key, set: result === 1, result };
  }

  /**
   * GETDEL - get and delete a value.
   *
   * @param key - Key
   * @returns Value before deletion
   */
  async getdel(key: string) {
    const value = await this.redis.getdel(key);
    return { key, value, wasDeleted: value !== null };
  }


  /**
   * Working with multiple clients.
   *
   * @returns Result of operations with different clients
   */
  async multipleClients() {
    // Get the default client
    const defaultClient = await this.redis.getClient();
    await defaultClient.set('default:key', 'value from default');

    // Can get a named client if configured
    try {
      const namedClient = await this.redis.getClient('sessions');
      await namedClient.set('sessions:key', 'value from sessions');

      return {
        success: true,
        clients: ['default', 'sessions'],
      };
    } catch (error) {
      return {
        success: true,
        clients: ['default'],
        note: 'Named clients not configured',
      };
    }
  }

  /**
   * TTL operations demo.
   *
   * @param key - Key
   * @returns TTL information
   */
  async ttlDemo(key: string) {
    // Set with TTL of 60 seconds
    await this.redis.setex(key, 60, 'temporary value');

    // Get the value and update its TTL
    const value = await this.redis.getex(key, { ex: 120 });

    return {
      key,
      value,
      initialTtl: 60,
      updatedTtl: 120,
      message: 'Value TTL updated from 60 to 120 seconds',
    };
  }

  /**
   * Batch operations for performance.
   *
   * @returns Batch operation results
   */
  async batchOperations() {
    const start = Date.now();

    // Set many keys in a single operation
    const data: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) {
      data[`batch:key${i}`] = `value${i}`;
    }
    await this.redis.mset(data);

    // Get all keys in a single operation
    const keys = Object.keys(data);
    const values = await this.redis.mget(...keys);

    const elapsed = Date.now() - start;

    return {
      keysSet: keys.length,
      keysRetrieved: values.filter((v) => v !== null).length,
      elapsedMs: elapsed,
      message: 'Batch operations are much faster than individual calls',
    };
  }
}
