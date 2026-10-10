import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { SEMAPHORE_REDIS_DRIVER } from '../../../shared/constants';
import { ISemaphoreStore } from '../../application/ports/semaphore-store.port';
import { ACQUIRE_PERMIT_SCRIPT, RELEASE_PERMIT_SCRIPT, EXTEND_PERMIT_SCRIPT, USED_PERMITS_SCRIPT, FORCE_RELEASE_ALL_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based semaphore store.
 *
 * Every operation is a single atomic Lua script over one sorted set
 * (member = permit id, score = expiry): expired permits are swept inside the
 * scripts, so crashed holders free their seats after the TTL without any
 * background job. One key per semaphore — cluster-safe without hash tags.
 */
@Injectable()
export class RedisSemaphoreStoreAdapter implements ISemaphoreStore, OnModuleInit {
  private readonly logger = new Logger(RedisSemaphoreStoreAdapter.name);
  private readonly scriptShas = new Map<string, string>();

  constructor(@Inject(SEMAPHORE_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-loads the Lua scripts and caches their SHA hashes. Best-effort: a
   * transient hiccup during bootstrap (LOADING after a Redis restart, a
   * failover mid-deploy) must not crash the application — every runtime
   * path lazily re-loads on demand.
   */
  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([this.loadScript(ACQUIRE_PERMIT_SCRIPT), this.loadScript(RELEASE_PERMIT_SCRIPT), this.loadScript(EXTEND_PERMIT_SCRIPT), this.loadScript(USED_PERMITS_SCRIPT), this.loadScript(FORCE_RELEASE_ALL_SCRIPT)]);
    } catch (error) {
      this.logger.warn(`Semaphore Lua pre-load failed (will retry lazily per call): ${(error as Error).message}`);
    }
  }

  async acquire(key: string, permitId: string, capacity: number, ttlMs: number, nowMs: number): Promise<boolean> {
    const result = await this.runScript(ACQUIRE_PERMIT_SCRIPT, [key], [permitId, capacity, nowMs, ttlMs]);
    return result === 1;
  }

  async release(key: string, permitId: string): Promise<boolean> {
    const result = await this.runScript(RELEASE_PERMIT_SCRIPT, [key], [permitId]);
    return result === 1;
  }

  async extend(key: string, permitId: string, ttlMs: number, nowMs: number): Promise<boolean> {
    const result = await this.runScript(EXTEND_PERMIT_SCRIPT, [key], [permitId, nowMs, ttlMs]);
    return result === 1;
  }

  async isHeld(key: string, permitId: string, nowMs: number): Promise<boolean> {
    const score = await this.driver.zscore(key, permitId);
    if (score === null || score === undefined) {
      return false;
    }
    return Number(score) > nowMs;
  }

  async usedPermits(key: string, nowMs: number): Promise<number> {
    const result = await this.runScript(USED_PERMITS_SCRIPT, [key], [nowMs]);
    return Number(result ?? 0);
  }

  async forceReleaseAll(key: string): Promise<number> {
    const result = await this.runScript(FORCE_RELEASE_ALL_SCRIPT, [key], []);
    return Number(result ?? 0);
  }

  /**
   * Runs a script by cached SHA, falling back to plain EVAL on NOSCRIPT
   * (script cache flushed, failover to a node without the script).
   */
  private async runScript(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    const sha = this.scriptShas.get(script) ?? (await this.loadScript(script));
    try {
      return await this.driver.evalsha(sha, keys, args);
    } catch (error) {
      if (!isNoScriptError(error)) {
        throw error;
      }
      // Re-load and retry once via plain EVAL (also refreshes the cache).
      this.scriptShas.delete(script);
      await this.loadScript(script).catch(() => undefined);
      return this.driver.eval(script, keys, args);
    }
  }

  private async loadScript(script: string): Promise<string> {
    const sha = await this.driver.scriptLoad(script);
    this.scriptShas.set(script, sha);
    return sha;
  }
}

function isNoScriptError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: Error }).cause?.message ?? '')}` : String(error);
  return message.includes('NOSCRIPT');
}
