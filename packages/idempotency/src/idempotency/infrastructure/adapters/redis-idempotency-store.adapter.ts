import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { IDEMPOTENCY_REDIS_DRIVER } from '../../../shared/constants';
import { IIdempotencyRecord } from '../../../shared/types';
import { IIdempotencyStore, ICheckAndLockResult, ICompleteData } from '../../application/ports/idempotency-store.port';
import { CHECK_AND_LOCK_SCRIPT, STORE_RECORD_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based idempotency store implementation
 */
@Injectable()
export class RedisIdempotencyStoreAdapter implements IIdempotencyStore, OnModuleInit {
  private checkAndLockSha: string | null = null;
  private storeRecordSha: string | null = null;

  constructor(@Inject(IDEMPOTENCY_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua scripts on module initialization
   */
  async onModuleInit(): Promise<void> {
    this.checkAndLockSha = await this.driver.scriptLoad(CHECK_AND_LOCK_SCRIPT);
    this.storeRecordSha = await this.driver.scriptLoad(STORE_RECORD_SCRIPT);
  }

  async checkAndLock(key: string, fingerprint: string, lockTimeoutMs: number, validateFingerprint = true): Promise<ICheckAndLockResult> {
    const now = Date.now();
    const rawResult = await this.driver.evalsha(this.checkAndLockSha!, [key], [fingerprint, lockTimeoutMs, now, validateFingerprint ? '1' : '0']);

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
    const fields: Record<string, string> = {
      status: 'completed',
      statusCode: String(data.statusCode),
      response: data.response,
      headers: data.headers || '',
      completedAt: String(data.completedAt),
    };
    // Persist the fingerprint too: if the record expired mid-handler (handler
    // ran longer than lockTimeout), the write re-creates the key — without the
    // fingerprint every later replay would be misread as a mismatch (422).
    if (data.fingerprint) {
      fields.fingerprint = data.fingerprint;
    }
    await this.storeRecord(key, fields, ttlSeconds);
  }

  async fail(key: string, error: string, ttlSeconds: number, fingerprint?: string): Promise<void> {
    const fields: Record<string, string> = {
      status: 'failed',
      error,
      completedAt: String(Date.now()),
    };
    if (fingerprint) {
      fields.fingerprint = fingerprint;
    }
    // The explicit (short) expiry means a fresh attempt with the same key is
    // allowed once the failure window passes.
    await this.storeRecord(key, fields, ttlSeconds);
  }

  /**
   * Writes all record fields AND the TTL atomically (single Lua script).
   * Two separate HMSET + EXPIRE commands left a crash window where the record
   * either kept the leftover lock TTL (early expiry -> duplicate execution)
   * or was re-created without any TTL at all (immortal key -> memory leak).
   */
  private async storeRecord(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void> {
    const args: (string | number)[] = [ttlSeconds * 1000];
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, value);
    }
    await this.driver.evalsha(this.storeRecordSha!, [key], args);
  }

  async get(key: string): Promise<IIdempotencyRecord | null> {
    const data = await this.driver.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      key,
      fingerprint: data.fingerprint ?? '',
      status: data.status! as 'processing' | 'completed' | 'failed',
      statusCode: data.statusCode ? parseInt(data.statusCode, 10) : undefined,
      response: data.response || undefined,
      headers: data.headers || undefined,
      startedAt: data.startedAt ? parseInt(data.startedAt, 10) : 0,
      completedAt: data.completedAt ? parseInt(data.completedAt, 10) : undefined,
      error: data.error || undefined,
    };
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.driver.del(key);
    return result > 0;
  }
}
