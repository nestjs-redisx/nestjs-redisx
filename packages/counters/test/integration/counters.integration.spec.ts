/**
 * Live-Redis integration tests (parity with the memory suite).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { CountersPlugin, CounterService, COUNTER_SERVICE, COUNTER_STORE, type ICounterService, type ICounterStore } from '../../src';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const SKIP = process.env.SKIP_INTEGRATION === 'true';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(SKIP)('CountersPlugin on live Redis', () => {
  let app: TestingModule;
  let serviceA: ICounterService;
  let serviceB: CounterService;
  const run = `${process.pid}-${Date.now()}`;

  const key = (name: string): string => `it:${run}:${name}`;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new CountersPlugin()],
        }),
      ],
    }).compile();
    await app.init();

    serviceA = app.get<ICounterService>(COUNTER_SERVICE);
    serviceB = new CounterService({}, app.get<ICounterStore>(COUNTER_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should never lose concurrent increments across instances', async () => {
    await Promise.all([...Array.from({ length: 25 }, () => serviceA.increment(key('hits'))), ...Array.from({ length: 25 }, () => serviceB.increment(key('hits')))]);
    expect(await serviceA.get(key('hits'))).toBe(50);
  });

  it('should expire a window counter with its first write', async () => {
    await serviceA.increment(key('win'), 1, { ttl: 150 });
    await wait(60);
    await serviceB.increment(key('win'), 1, { ttl: 150 });
    await wait(130);
    expect(await serviceA.get(key('win'))).toBe(0);
  });

  it('should getAndReset atomically and issue monotonic sequences', async () => {
    await serviceA.increment(key('batch'), 9);
    expect(await serviceB.getAndReset(key('batch'))).toBe(9);
    expect(await serviceA.get(key('batch'))).toBe(0);

    const values = await Promise.all([serviceA.next(key('seq')), serviceB.next(key('seq')), serviceA.next(key('seq'))]);
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
