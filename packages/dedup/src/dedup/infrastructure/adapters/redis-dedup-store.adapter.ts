import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { DEDUP_REDIS_DRIVER } from '../../../shared/constants';
import { IDedupStore } from '../../application/ports/dedup-store.port';
import { RELEASE_IF_OWNER_SCRIPT, CLAIM_LAST_CALL_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based dedup store.
 *
 * Markers are plain keys (SET NX PX); the owner-checked release and the
 * debounce last-call claim are atomic Lua CAS scripts.
 */
@Injectable()
export class RedisDedupStoreAdapter implements IDedupStore, OnModuleInit {
  private readonly logger = new Logger(RedisDedupStoreAdapter.name);
  private readonly scriptShas = new Map<string, string>();

  constructor(@Inject(DEDUP_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-loads the Lua scripts. Best-effort: a transient hiccup during
   * bootstrap must not crash the application - every runtime path lazily
   * re-loads on demand.
   */
  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([this.loadScript(RELEASE_IF_OWNER_SCRIPT), this.loadScript(CLAIM_LAST_CALL_SCRIPT)]);
    } catch (error) {
      // Total containment: a nullish rejection must not crash bootstrap
      // from inside the very catch that exists to prevent crashes.
      const description = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Dedup Lua pre-load failed (will retry lazily per call): ${description}`);
    }
  }

  async markFirst(key: string, token: string, windowMs: number): Promise<boolean> {
    const result = await this.driver.set(key, token, { nx: true, px: windowMs });
    return result === 'OK';
  }

  async releaseIfOwner(key: string, token: string): Promise<boolean> {
    const result = await this.runScript(RELEASE_IF_OWNER_SCRIPT, [key], [token]);
    return result === 1;
  }

  async release(key: string): Promise<boolean> {
    const count = await this.driver.del(key);
    return count > 0;
  }

  async stampLastCall(key: string, callId: string, ttlMs: number): Promise<void> {
    await this.driver.set(key, callId, { px: ttlMs });
  }

  async claimLastCall(key: string, callId: string): Promise<'claimed' | 'superseded' | 'expired'> {
    const result = await this.runScript(CLAIM_LAST_CALL_SCRIPT, [key], [callId]);
    if (result === 1) {
      return 'claimed';
    }
    return result === -1 ? 'expired' : 'superseded';
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
