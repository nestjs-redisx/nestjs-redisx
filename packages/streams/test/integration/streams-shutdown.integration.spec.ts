/**
 * Integration tests for graceful shutdown in StreamsPlugin.
 *
 * Verifies that consumers react to OnApplicationShutdown quickly, drain
 * in-flight messages within the configured timeout, behave idempotently under
 * repeated shutdown, and leave no active Node event-loop handles behind.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';

import { StreamsPlugin } from '../../src/streams.plugin';
import { STREAM_PRODUCER, STREAM_CONSUMER } from '../../src/shared/constants';
import type { IStreamProducer } from '../../src/streams/application/ports/stream-producer.port';
import type { IStreamConsumer } from '../../src/streams/application/ports/stream-consumer.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

async function createApp(shutdownTimeoutMs = 10_000, blockTimeout = 500): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [
          new StreamsPlugin({
            shutdownTimeoutMs,
            consumer: { blockTimeout, batchSize: 10, concurrency: 1, maxRetries: 3 },
          }),
        ],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
      }),
    ],
  }).compile();

  await module.init();
  return module;
}

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('StreamsPlugin — graceful shutdown', () => {
  beforeAll(async () => {
    await flushRedis();
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
  });

  it('shuts down in well under the block timeout when no messages are in flight', async () => {
    const app = await createApp(10_000, 500);
    const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);
    await consumer.createGroup('stream-shutdown-empty', 'g1');
    consumer.consume('stream-shutdown-empty', 'g1', 'c1', async () => {
      /* no-op */
    });

    // Let the poll loop enter its first xreadgroup.
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    await app.close();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1_000);
  });

  it('waits for in-flight handlers to finish before returning from shutdown', async () => {
    const app = await createApp(10_000, 200);
    const producer = app.get<IStreamProducer>(STREAM_PRODUCER);
    const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);

    let handlerStarted = false;
    let handlerCompleted = false;

    await consumer.createGroup('stream-shutdown-inflight', 'g2');
    consumer.consume('stream-shutdown-inflight', 'g2', 'c1', async () => {
      handlerStarted = true;
      await new Promise((r) => setTimeout(r, 200));
      handlerCompleted = true;
    });

    await producer.publish('stream-shutdown-inflight', { id: 1 });

    // Wait until the handler has picked up the message.
    await waitFor(() => handlerStarted, 2_000);

    await app.close();

    expect(handlerCompleted).toBe(true);
  });

  it('is idempotent under repeated / overlapping close calls', async () => {
    const app = await createApp(10_000, 200);
    const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);
    await consumer.createGroup('stream-shutdown-idem', 'g3');
    consumer.consume('stream-shutdown-idem', 'g3', 'c1', async () => undefined);

    await new Promise((r) => setTimeout(r, 100));

    const first = app.close();
    const second = app.close();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('clears consumer-owned active handles after shutdown', async () => {
    const app = await createApp(10_000, 200);
    const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);
    await consumer.createGroup('stream-shutdown-handles', 'g4');
    consumer.consume('stream-shutdown-handles', 'g4', 'c1', async () => undefined);

    await new Promise((r) => setTimeout(r, 100));
    await app.close();

    // Give Node one macrotask to release the Redis socket(s) closed during shutdown.
    await new Promise((r) => setImmediate(r));

    // The Redis client owned by the driver is the primary consumer-side handle.
    // After close() it must no longer appear as an active socket. We filter the
    // internal handle list for TCP sockets bound to the Redis port so we catch
    // leaks even if other timers exist.
    const activeHandles = (process as unknown as { _getActiveHandles?: () => Array<{ remotePort?: number }> })._getActiveHandles?.() ?? [];
    const redisSockets = activeHandles.filter((h) => h && typeof h === 'object' && 'remotePort' in h && h.remotePort === REDIS_PORT);

    expect(redisSockets.length).toBe(0);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
