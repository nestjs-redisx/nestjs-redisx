import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { LEADER_REDIS_DRIVER } from '../../../shared/constants';
import { LeaderStoreError } from '../../../shared/errors';
import { ILeaderStore } from '../../application/ports/leader-store.port';
import { ACQUIRE_LEADER_SCRIPT, RENEW_LEADER_SCRIPT, RELEASE_LEADER_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based leader store.
 * All mutations are CAS Lua scripts: acquire is a SET NX PX that also
 * re-claims a lease this instance already holds, renew/release extend or
 * delete only while this instance is the holder.
 */
@Injectable()
export class RedisLeaderStoreAdapter implements ILeaderStore, OnModuleInit {
  private readonly logger = new Logger(RedisLeaderStoreAdapter.name);

  private acquireSha: string | null = null;
  private renewSha: string | null = null;
  private releaseSha: string | null = null;

  constructor(@Inject(LEADER_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua scripts on module initialization. Best effort: a transient
   * hiccup here (Redis LOADING after a restart, a failover mid-bootstrap)
   * must not crash the whole application — every runtime path degrades to a
   * plain EVAL while the shas are null, and the election loop contains store
   * errors anyway.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.acquireSha = await this.driver.scriptLoad(ACQUIRE_LEADER_SCRIPT);
      this.renewSha = await this.driver.scriptLoad(RENEW_LEADER_SCRIPT);
      this.releaseSha = await this.driver.scriptLoad(RELEASE_LEADER_SCRIPT);
    } catch (error) {
      this.logger.warn(`Failed to pre-load leader Lua scripts (continuing with plain EVAL): ${(error as Error).message}`);
    }
  }

  async acquire(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    const result = await this.runScript('acquire', this.acquireSha, ACQUIRE_LEADER_SCRIPT, [key], [instanceId, ttlMs]);
    return result === 1;
  }

  async renew(key: string, instanceId: string, ttlMs: number): Promise<boolean> {
    const result = await this.runScript('renew', this.renewSha, RENEW_LEADER_SCRIPT, [key], [instanceId, ttlMs]);
    return result === 1;
  }

  async release(key: string, instanceId: string): Promise<boolean> {
    const result = await this.runScript('release', this.releaseSha, RELEASE_LEADER_SCRIPT, [key], [instanceId]);
    return result === 1;
  }

  async getHolder(key: string): Promise<string | null> {
    try {
      return await this.driver.get(key);
    } catch (error) {
      throw new LeaderStoreError(`Leader lookup failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * EVALSHA with an EVAL fallback on NOSCRIPT (e.g. after a Redis restart
   * flushed the script cache; EVAL re-caches, so the stored sha works again).
   */
  private async runScript(operation: string, sha: string | null, script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    if (sha === null) {
      // onModuleInit has not run (yet) — EVAL directly; it also populates the
      // server-side script cache.
      try {
        return await this.driver.eval(script, keys, args);
      } catch (error) {
        throw new LeaderStoreError(`Leader ${operation} failed: ${(error as Error).message}`, error as Error);
      }
    }
    try {
      return await this.driver.evalsha(sha, keys, args);
    } catch (error) {
      if (this.isNoScriptError(error)) {
        try {
          return await this.driver.eval(script, keys, args);
        } catch (fallbackError) {
          throw new LeaderStoreError(`Leader ${operation} failed: ${(fallbackError as Error).message}`, fallbackError as Error);
        }
      }
      throw new LeaderStoreError(`Leader ${operation} failed: ${(error as Error).message}`, error as Error);
    }
  }

  private isNoScriptError(error: unknown): boolean {
    const message = (error as Error).message ?? '';
    return message.includes('NOSCRIPT') || message.includes('No matching script');
  }
}
