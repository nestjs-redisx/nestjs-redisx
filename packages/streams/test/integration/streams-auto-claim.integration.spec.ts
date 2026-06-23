/**
 * Integration tests for streams auto-claim (claimIdleTimeout) and
 * producer.autoCreate against a real Redis instance.
 *
 * Auto-claim reclaims messages left pending by a crashed/idle consumer so they
 * are not stuck forever. producer.autoCreate=false sets NOMKSTREAM so a publish
 * does not implicitly create a missing stream.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { StreamsPlugin } from '../../src/streams.plugin';
import { STREAM_PRODUCER, STREAM_CONSUMER } from '../../src/shared/constants';
import type { IStreamProducer } from '../../src/streams/application/ports/stream-producer.port';
import type { IStreamConsumer } from '../../src/streams/application/ports/stream-consumer.port';

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

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
};

describeIntegration('StreamsPlugin — auto-claim & autoCreate', () => {
  let module: TestingModule;
  let producer: IStreamProducer;
  let consumer: IStreamConsumer;

  beforeAll(async () => {
    await withRawClient((c) => c.flushdb());

    module = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new StreamsPlugin({ consumer: { blockTimeout: 200, claimIdleTimeout: 200 } })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();

    await module.init();
    producer = module.get<IStreamProducer>(STREAM_PRODUCER);
    consumer = module.get<IStreamConsumer>(STREAM_CONSUMER);
  });

  beforeEach(async () => {
    await withRawClient((c) => c.flushdb());
  });

  afterAll(async () => {
    await module.close();
    await withRawClient((c) => c.flushdb());
  });

  it('reclaims a message left pending by a crashed consumer', async () => {
    // Given - a message delivered to a "dead" consumer that never acks
    const stream = 'auto-claim-stream';
    const group = 'g1';
    await consumer.createGroup(stream, group);
    await producer.publish(stream, { task: 'orphaned' });

    await withRawClient((c) => c.xreadgroup('GROUP', group, 'dead-consumer', 'COUNT', 1, 'STREAMS', stream, '>') as Promise<unknown>);

    // When - a live consumer with auto-claim enabled starts
    const received: Array<{ task: string }> = [];
    consumer.consume<{ task: string }>(stream, group, 'live-consumer', async (msg) => {
      received.push(msg.data);
    });

    // Then - the orphaned message is reclaimed and processed (it is NOT a new
    // message, so only auto-claim could deliver it)
    await waitFor(() => received.length > 0, 5_000);
    expect(received[0]).toEqual({ task: 'orphaned' });
  });

  it('does not create a stream on publish when autoCreate is false', async () => {
    // Given - a producer configured with autoCreate: false
    const noCreateModule = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [new StreamsPlugin({ producer: { autoCreate: false } })],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();
    await noCreateModule.init();
    const noCreateProducer = noCreateModule.get<IStreamProducer>(STREAM_PRODUCER);

    // When - publishing to a stream that does not exist
    await noCreateProducer.publish('missing-stream', { a: 1 });

    // Then - the stream was not created
    const exists = await withRawClient((c) => c.exists('missing-stream'));
    expect(exists).toBe(0);

    await noCreateModule.close();
  });
});
