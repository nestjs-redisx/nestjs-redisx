import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { COUNTERS_REDIS_DRIVER } from '../../../shared/constants';
import { ICounterStore } from '../../application/ports/counter-store.port';
import { INCRBY_WITH_WINDOW_SCRIPT, GET_AND_RESET_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based counter store.
 *
 * Plain INCRBY for unwindowed mutations; atomic Lua for the first-write
 * window TTL and for read-and-reset.
 */
@Injectable()
export class RedisCounterStoreAdapter implements ICounterStore, OnModuleInit {
  private readonly logger = new Logger(RedisCounterStoreAdapter.name);
  private readonly scriptShas = new Map<string, string>();

  constructor(@Inject(COUNTERS_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-loads the Lua scripts. Best-effort: a transient hiccup during
   * bootstrap must not crash the application — every runtime path lazily
   * re-loads on demand.
   */
  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([this.loadScript(INCRBY_WITH_WINDOW_SCRIPT), this.loadScript(GET_AND_RESET_SCRIPT)]);
    } catch (error) {
      this.logger.warn(`Counters Lua pre-load failed (will retry lazily per call): ${(error as Error).message}`);
    }
  }

  async incrementBy(key: string, by: number, ttlMs?: number): Promise<number> {
    if (ttlMs === undefined) {
      return this.driver.incrby(key, by);
    }
    const result = await this.runScript(INCRBY_WITH_WINDOW_SCRIPT, [key], [by, ttlMs]);
    return Number(result);
  }

  async get(key: string): Promise<number | null> {
    const raw = await this.driver.get(key);
    return raw === null ? null : Number(raw);
  }

  async set(key: string, value: number, ttlMs?: number): Promise<void> {
    if (ttlMs === undefined) {
      await this.driver.set(key, String(value));
      return;
    }
    await this.driver.set(key, String(value), { px: ttlMs });
  }

  async reset(key: string): Promise<boolean> {
    const count = await this.driver.del(key);
    return count > 0;
  }

  async getAndReset(key: string): Promise<number> {
    const result = await this.runScript(GET_AND_RESET_SCRIPT, [key], []);
    return Number(result ?? 0);
  }

  /**
   * Runs a script by cached SHA, falling back to plain EVAL on NOSCRIPT.
   */
  private async runScript(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    const sha = this.scriptShas.get(script) ?? (await this.loadScript(script));
    try {
      return await this.driver.evalsha(sha, keys, args);
    } catch (error) {
      if (!isNoScriptError(error)) {
        throw error;
      }
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
