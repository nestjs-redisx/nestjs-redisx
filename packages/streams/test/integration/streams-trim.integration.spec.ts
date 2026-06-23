/**
 * Integration tests for the streams `trim` configuration against a real Redis
 * instance.
 *
 * Verifies that `trim.maxLen` actually caps the stream length and that
 * `trim.enabled: false` (keep-all) leaves the stream untrimmed.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { StreamsPlugin } from '../../src/streams.plugin';
import { STREAM_PRODUCER } from '../../src/shared/constants';
import type { IStreamProducer } from '../../src/streams/application/ports/stream-producer.port';

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

async function createProducer(trim: { enabled?: boolean; maxLen?: number; approximate?: boolean }): Promise<{ module: TestingModule; producer: IStreamProducer }> {
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [new StreamsPlugin({ trim })],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
      }),
    ],
  }).compile();

  await module.init();
  return { module, producer: module.get<IStreamProducer>(STREAM_PRODUCER) };
}

describeIntegration('StreamsPlugin — trim configuration', () => {
  beforeEach(async () => {
    await withRawClient((c) => c.flushdb());
  });

  afterAll(async () => {
    await withRawClient((c) => c.flushdb());
  });

  it('caps the stream length with an exact trim.maxLen', async () => {
    // Given - exact MAXLEN of 5
    const { module, producer } = await createProducer({ enabled: true, maxLen: 5, approximate: false });

    // When - publish 20 messages
    for (let i = 0; i < 20; i++) {
      await producer.publish('trim:capped', { i });
    }

    // Then - the stream is trimmed to 5
    const length = await withRawClient((c) => c.xlen('trim:capped'));
    expect(length).toBe(5);

    await module.close();
  });

  it('keeps all entries when trim.enabled is false', async () => {
    // Given
    const { module, producer } = await createProducer({ enabled: false });

    // When - publish 20 messages
    for (let i = 0; i < 20; i++) {
      await producer.publish('trim:keepall', { i });
    }

    // Then - nothing is trimmed
    const length = await withRawClient((c) => c.xlen('trim:keepall'));
    expect(length).toBe(20);

    await module.close();
  });
});
