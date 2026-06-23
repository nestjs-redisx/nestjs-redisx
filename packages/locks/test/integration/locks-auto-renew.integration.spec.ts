/**
 * Integration tests for lock auto-renewal failure visibility against a real
 * Redis instance.
 *
 * When auto-renewal can no longer extend the lock (e.g. the key was lost), the
 * failure must be surfaced (logged) instead of being swallowed silently.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { LocksPlugin } from '../../src/locks.plugin';
import { LOCK_SERVICE } from '../../src/shared/constants';
import type { ILockService } from '../../src/lock/application/ports/lock-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

async function withRawClient<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit();
  }
}

describeIntegration('LocksPlugin — auto-renewal failure visibility', () => {
  let moduleRef: TestingModule;
  let lockService: ILockService;

  beforeAll(async () => {
    await withRawClient((c) => c.flushdb());

    moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          // Short renewal interval (ttl * intervalFraction) so the failing tick
          // happens quickly.
          plugins: [new LocksPlugin({ autoRenew: { enabled: true, intervalFraction: 0.5 } })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();

    await moduleRef.init();
    lockService = moduleRef.get<ILockService>(LOCK_SERVICE);
  });

  beforeEach(async () => {
    await withRawClient((c) => c.flushdb());
  });

  afterAll(async () => {
    await withRawClient((c) => c.flushdb());
    await moduleRef.close();
  });

  it('logs a warning and stops renewing when the lock is lost', async () => {
    // Given - a lock with auto-renew and a short ttl (renewal interval ~200ms)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const lock = await lockService.acquire('auto-renew-lost', { ttl: 400, autoRenew: true });

    // When - the lock key disappears underneath the renewer
    await withRawClient((c) => c.del('_lock:auto-renew-lost'));

    // Wait for at least one failed renewal tick.
    await new Promise((r) => setTimeout(r, 600));

    // Then - the failure was surfaced and renewal stopped
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('auto-renew-lost'));
    expect(lock.isAutoRenewing).toBe(false);

    warnSpy.mockRestore();
  });
});
