/**
 * End-to-end validation on the in-memory driver — NO Redis. Exercises the
 * full stack (service -> SET NX PX + CAS Lua -> memory interpreter) through
 * production code, including @Dedupe and the distributed debounce.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { DedupPlugin, DedupService, Dedupe, DEDUP_SERVICE, DEDUP_STORE, type IDedupService, type IDedupStore } from '../../src';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

@Injectable()
class WebhookHandler {
  handled: string[] = [];

  @Dedupe({ key: 'hook:{0}', window: 2_000 })
  async handle(id: string): Promise<string> {
    this.handled.push(id);
    return `handled:${id}`;
  }
}

describe('DedupPlugin on the in-memory driver (no Redis)', () => {
  let app: TestingModule;
  let serviceA: IDedupService;
  let serviceB: DedupService;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'unused', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new DedupPlugin({ defaultWindow: 2_000 })],
        }),
      ],
      providers: [WebhookHandler],
    }).compile();
    await app.init();

    serviceA = app.get<IDedupService>(DEDUP_SERVICE);
    // Second "instance" over the SAME store
    serviceB = new DedupService({ defaultWindow: 2_000 }, app.get<IDedupStore>(DEDUP_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should admit exactly one first across two instances', async () => {
    // When — both instances race the same event key
    const [a, b] = await Promise.all([serviceA.isFirst('evt:1'), serviceB.isFirst('evt:1')]);

    // Then — exactly one winner
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await serviceA.isFirst('evt:1')).toBe(false);
  });

  it('should re-admit the key after the window expires', async () => {
    // Given
    expect(await serviceA.isFirst('evt:ttl', { window: 100 })).toBe(true);
    expect(await serviceB.isFirst('evt:ttl', { window: 100 })).toBe(false);

    // When
    await wait(140);

    // Then — a new window opens
    expect(await serviceB.isFirst('evt:ttl', { window: 100 })).toBe(true);
  });

  it('should run dedupe exactly once and re-open the window after a failure', async () => {
    // Given — first run fails
    await expect(
      serviceA.dedupe('order:1', async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow('transient');

    // When — a retry (even from another instance) runs because the failed
    // first released its marker
    const retried = await serviceB.dedupe('order:1', async () => 'second-try');

    // Then
    expect(retried).toBe('second-try');

    // And a THIRD call within the window is now a duplicate
    expect(await serviceA.dedupe('order:1', async () => 'third')).toBeUndefined();
  });

  it('should gate @Dedupe-decorated methods across concurrent calls', async () => {
    // Given
    const handler = app.get(WebhookHandler);

    // When — 5 concurrent deliveries of the same webhook id
    const results = await Promise.all(Array.from({ length: 5 }, () => handler.handle('wh-1')));

    // Then — the body ran once; one caller got the result, the rest skipped
    expect(handler.handled).toEqual(['wh-1']);
    expect(results.filter((r) => r === 'handled:wh-1')).toHaveLength(1);
    expect(results.filter((r) => r === undefined)).toHaveLength(4);

    // And a different id is independent
    expect(await handler.handle('wh-2')).toBe('handled:wh-2');
  });

  it('should debounce to the LAST caller across instances', async () => {
    // When — A calls, then B supersedes it inside the window
    const first = serviceA.debounce('reindex', async () => 'ran-A', { window: 120 });
    await wait(40);
    const second = serviceB.debounce('reindex', async () => 'ran-B', { window: 120 });

    // Then — only the last call executes
    expect(await first).toBeUndefined();
    expect(await second).toBe('ran-B');
  });

  it('should release a marker manually to re-admit immediately', async () => {
    // Given
    expect(await serviceA.isFirst('manual')).toBe(true);
    expect(await serviceB.isFirst('manual')).toBe(false);

    // When
    expect(await serviceA.release('manual')).toBe(true);

    // Then
    expect(await serviceB.isFirst('manual')).toBe(true);
  });
});
