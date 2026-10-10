/**
 * Live-Redis integration tests (parity with the memory suite).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { DedupPlugin, DedupService, DEDUP_SERVICE, DEDUP_STORE, type IDedupService, type IDedupStore } from '../../src';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const SKIP = process.env.SKIP_INTEGRATION === 'true';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(SKIP)('DedupPlugin on live Redis', () => {
  let app: TestingModule;
  let serviceA: IDedupService;
  let serviceB: DedupService;
  const run = `${process.pid}-${Date.now()}`; // unique keys per run — shared server

  const key = (name: string): string => `it:${run}:${name}`;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new DedupPlugin({ defaultWindow: 2_000 })],
        }),
      ],
    }).compile();
    await app.init();

    serviceA = app.get<IDedupService>(DEDUP_SERVICE);
    serviceB = new DedupService({ defaultWindow: 2_000 }, app.get<IDedupStore>(DEDUP_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should admit exactly one first across racing instances', async () => {
    // When
    const results = await Promise.all([serviceA.isFirst(key('race')), serviceB.isFirst(key('race')), serviceA.isFirst(key('race')), serviceB.isFirst(key('race'))]);

    // Then
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('should expire the window by TTL', async () => {
    // Given
    expect(await serviceA.isFirst(key('ttl'), { window: 150 })).toBe(true);

    // When
    await wait(200);

    // Then
    expect(await serviceB.isFirst(key('ttl'), { window: 150 })).toBe(true);
  });

  it('should run dedupe once, skip duplicates, and re-open after a failure', async () => {
    // Given — a failing first
    await expect(
      serviceA.dedupe(key('order'), async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow('transient');

    // When/Then — retry runs, then duplicates skip
    expect(await serviceB.dedupe(key('order'), async () => 'retried')).toBe('retried');
    expect(await serviceA.dedupe(key('order'), async () => 'dup')).toBeUndefined();
  });

  it('should debounce to the LAST caller across instances', async () => {
    // When
    const first = serviceA.debounce(key('reindex'), async () => 'ran-A', { window: 150 });
    await wait(50);
    const second = serviceB.debounce(key('reindex'), async () => 'ran-B', { window: 150 });

    // Then
    expect(await first).toBeUndefined();
    expect(await second).toBe('ran-B');
  });

  it('should release a marker manually', async () => {
    // Given
    expect(await serviceA.isFirst(key('manual'))).toBe(true);

    // When/Then
    expect(await serviceA.release(key('manual'))).toBe(true);
    expect(await serviceB.isFirst(key('manual'))).toBe(true);
  });
});
