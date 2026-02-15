import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver, REDIS_DRIVER } from '@nestjs-redisx/core';

import { ILockStore } from '../../application/ports/lock-store.port';
import { RELEASE_LOCK_SCRIPT, EXTEND_LOCK_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based lock store implementation.
 *
 * Uses atomic Redis operations for lock management:
 * - SET NX PX for acquiring locks
 * - Lua scripts for safe release and extension
 */
@Injectable()
export class RedisLockStoreAdapter implements ILockStore, OnModuleInit {
  private releaseSha: string | null = null;
  private extendSha: string | null = null;

  constructor(@Inject(REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Lifecycle hook: loads Lua scripts into Redis on initialization.
   */
  async onModuleInit(): Promise<void> {
    // Pre-load Lua scripts and cache their SHA hashes
    this.releaseSha = await this.driver.scriptLoad(RELEASE_LOCK_SCRIPT);
    this.extendSha = await this.driver.scriptLoad(EXTEND_LOCK_SCRIPT);
  }

  /**
   * Acquires lock using SET NX PX.
   */
  async acquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.driver.set(key, token, {
      nx: true, // Only set if key doesn't exist
      px: ttlMs, // TTL in milliseconds
    });
    return result === 'OK';
  }

  /**
   * Releases lock if owned by token (Lua script).
   */
  async release(key: string, token: string): Promise<boolean> {
    if (!this.releaseSha) {
      // Fallback if script not loaded
      this.releaseSha = await this.driver.scriptLoad(RELEASE_LOCK_SCRIPT);
    }

    const result = await this.driver.evalsha(this.releaseSha, [key], [token]);
    return result === 1;
  }

  /**
   * Extends lock TTL if owned by token (Lua script).
   */
  async extend(key: string, token: string, ttlMs: number): Promise<boolean> {
    if (!this.extendSha) {
      // Fallback if script not loaded
      this.extendSha = await this.driver.scriptLoad(EXTEND_LOCK_SCRIPT);
    }

    const result = await this.driver.evalsha(this.extendSha, [key], [token, ttlMs]);
    return result === 1;
  }

  /**
   * Checks if lock key exists.
   */
  async exists(key: string): Promise<boolean> {
    const count = await this.driver.exists(key);
    return count > 0;
  }

  /**
   * Checks if lock is held by specific token.
   */
  async isHeldBy(key: string, token: string): Promise<boolean> {
    const value = await this.driver.get(key);
    return value === token;
  }

  /**
   * Force removes lock without ownership check.
   */
  async forceRelease(key: string): Promise<boolean> {
    const count = await this.driver.del(key);
    return count > 0;
  }
}
