import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { LEADER_REDIS_DRIVER } from '../../../shared/constants';
import { LeaderStoreError } from '../../../shared/errors';
import { ILeaderStore } from '../../application/ports/leader-store.port';
import { RENEW_LEADER_SCRIPT, RELEASE_LEADER_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based leader store.
 * Acquire is a plain SET NX PX; renew/release are CAS Lua scripts so only the
 * current holder can extend or delete the lease.
 */
@Injectable()
export class RedisLeaderStoreAdapter implements ILeaderStore, OnModuleInit {
  private renewSha: string | null = null;
  private releaseSha: string | null = null;

  constructor(@Inject(LEADER_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua scripts on module initialization.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.renewSha = await this.driver.scriptLoad(RENEW_LEADER_SCRIPT);
      this.releaseSha = await this.driver.scriptLoad(RELEASE_LEADER_SCRIPT);
    } catch (error) {
      throw new LeaderStoreError(`Failed to load leader Lua scripts: ${(error as Error).message}`, error as Error);
    }
  }

  async acquire(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.driver.set(key, instanceId, { nx: true, px: ttlMs });
      return result === 'OK';
    } catch (error) {
      throw new LeaderStoreError(`Leader acquire failed: ${(error as Error).message}`, error as Error);
    }
  }

  async renew(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.driver.evalsha(this.renewSha!, [key], [instanceId, ttlMs]);
      return result === 1;
    } catch (error) {
      if (this.isNoScriptError(error)) {
        try {
          const result = await this.driver.eval(RENEW_LEADER_SCRIPT, [key], [instanceId, ttlMs]);
          return result === 1;
        } catch (fallbackError) {
          throw new LeaderStoreError(`Leader renew failed: ${(fallbackError as Error).message}`, fallbackError as Error);
        }
      }
      throw new LeaderStoreError(`Leader renew failed: ${(error as Error).message}`, error as Error);
    }
  }

  async release(key: string, instanceId: string): Promise<boolean> {
    try {
      const result = await this.driver.evalsha(this.releaseSha!, [key], [instanceId]);
      return result === 1;
    } catch (error) {
      if (this.isNoScriptError(error)) {
        try {
          const result = await this.driver.eval(RELEASE_LEADER_SCRIPT, [key], [instanceId]);
          return result === 1;
        } catch (fallbackError) {
          throw new LeaderStoreError(`Leader release failed: ${(fallbackError as Error).message}`, fallbackError as Error);
        }
      }
      throw new LeaderStoreError(`Leader release failed: ${(error as Error).message}`, error as Error);
    }
  }

  async getHolder(key: string): Promise<string | null> {
    try {
      return await this.driver.get(key);
    } catch (error) {
      throw new LeaderStoreError(`Leader lookup failed: ${(error as Error).message}`, error as Error);
    }
  }

  private isNoScriptError(error: unknown): boolean {
    const message = (error as Error).message ?? '';
    return message.includes('NOSCRIPT') || message.includes('No matching script');
  }
}
