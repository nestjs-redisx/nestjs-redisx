/**
 * End-to-end validation on the in-memory driver — NO Redis. Exercises the
 * full stack (service -> INCRBY / Lua window+reset scripts -> memory
 * interpreter) through production code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { CountersPlugin, CounterService, COUNTER_SERVICE, COUNTER_STORE, type ICounterService, type ICounterStore } from '../../src';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

describe('CountersPlugin on the in-memory driver (no Redis)', () => {
  let app: TestingModule;
  let serviceA: ICounterService;
  let serviceB: CounterService;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'unused', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CountersPlugin()],
        }),
      ],
    }).compile();
    await app.init();

    serviceA = app.get<ICounterService>(COUNTER_SERVICE);
    // Second "instance" over the SAME store
    serviceB = new CounterService({}, app.get<ICounterStore>(COUNTER_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should never lose concurrent increments across two instances', async () => {
    // When — 50 increments interleaved from both instances
    await Promise.all([...Array.from({ length: 25 }, () => serviceA.increment('hits')), ...Array.from({ length: 25 }, () => serviceB.increment('hits'))]);

    // Then
    expect(await serviceA.get('hits')).toBe(50);
    expect(await serviceB.get('hits')).toBe(50);
  });

  it('should apply the window TTL only on the first write (real Lua)', async () => {
    // Given — a short window counter
    await serviceA.increment('win', 1, { ttl: 120 });
    await wait(60);
    // A later increment must NOT extend the window
    await serviceB.increment('win', 1, { ttl: 120 });
    expect(await serviceA.get('win')).toBe(2);

    // When — past the ORIGINAL window
    await wait(90);

    // Then — the counter expired with its first write
    expect(await serviceA.get('win')).toBe(0);
  });

  it('should getAndReset atomically (flush consumption)', async () => {
    // Given
    await serviceA.increment('batch', 7);

    // When
    const flushed = await serviceB.getAndReset('batch');

    // Then — consumed exactly once
    expect(flushed).toBe(7);
    expect(await serviceA.get('batch')).toBe(0);
    expect(await serviceA.getAndReset('batch')).toBe(0);
  });

  it('should issue strictly monotonic sequence values across instances', async () => {
    // When — both instances pull from the same sequence concurrently
    const values = await Promise.all([serviceA.next('seq:orders'), serviceB.next('seq:orders'), serviceA.next('seq:orders'), serviceB.next('seq:orders')]);

    // Then — unique, covering 1..4
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(await serviceA.current('seq:orders')).toBe(4);
  });

  it('should set, decrement below zero, and reset', async () => {
    // Given
    await serviceA.set('stock', 2);

    // When
    expect(await serviceB.decrement('stock', 5)).toBe(-3);

    // Then
    expect(await serviceA.reset('stock')).toBe(true);
    expect(await serviceA.get('stock')).toBe(0);
  });
});
