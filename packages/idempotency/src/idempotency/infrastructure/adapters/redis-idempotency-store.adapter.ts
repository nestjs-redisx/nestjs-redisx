import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver, REDIS_DRIVER } from '@nestjs-redisx/core';

import { IIdempotencyRecord } from '../../../shared/types';
import { IIdempotencyStore, ICheckAndLockResult, ICompleteData } from '../../application/ports/idempotency-store.port';
import { CHECK_AND_LOCK_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based idempotency store implementation
 */
@Injectable()
export class RedisIdempotencyStoreAdapter implements IIdempotencyStore, OnModuleInit {
  private checkAndLockSha: string | null = null;

  constructor(@Inject(REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua script on module initialization
   */
  async onModuleInit(): Promise<void> {
    this.checkAndLockSha = await this.driver.scriptLoad(CHECK_AND_LOCK_SCRIPT);
  }

  async checkAndLock(key: string, fingerprint: string, lockTimeoutMs: number): Promise<ICheckAndLockResult> {
    const now = Date.now();
    const rawResult = await this.driver.evalsha(this.checkAndLockSha!, [key], [fingerprint, lockTimeoutMs, now]);

    // Normalize result: node-redis may return Buffer/null elements
    const result = (rawResult as unknown[]).map((v) => (v === null || v === undefined ? '' : String(v)));

    const status = result[0];

    if (status === 'new') {
      return { status: 'new' };
    }

    if (status === 'fingerprint_mismatch') {
      return { status: 'fingerprint_mismatch' };
    }

    if (status === 'processing') {
      return { status: 'processing' };
    }

    // completed or failed
    return {
      status: status as 'completed' | 'failed',
      record: {
        key,
        fingerprint,
        status: status as 'completed' | 'failed',
        statusCode: result[1] ? parseInt(result[1], 10) : undefined,
        response: result[2] || undefined,
        headers: result[3] || undefined,
        error: result[4] || undefined,
        startedAt: 0, // Not returned from Lua
      },
    };
  }

  async complete(key: string, data: ICompleteData, ttlSeconds: number): Promise<void> {
    await this.driver.hmset(key, {
      status: 'completed',
      statusCode: String(data.statusCode),
      response: data.response,
      headers: data.headers || '',
      completedAt: String(data.completedAt),
    });
    await this.driver.expire(key, ttlSeconds);
  }

  async fail(key: string, error: string): Promise<void> {
    await this.driver.hmset(key, {
      status: 'failed',
      error,
      completedAt: String(Date.now()),
    });
  }

  async get(key: string): Promise<IIdempotencyRecord | null> {
    const data = await this.driver.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      key,
      fingerprint: data.fingerprint!,
      status: data.status! as 'processing' | 'completed' | 'failed',
      statusCode: data.statusCode ? parseInt(data.statusCode, 10) : undefined,
      response: data.response || undefined,
      headers: data.headers || undefined,
      startedAt: parseInt(data.startedAt!, 10),
      completedAt: data.completedAt ? parseInt(data.completedAt, 10) : undefined,
      error: data.error || undefined,
    };
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.driver.del(key);
    return result > 0;
  }
}
