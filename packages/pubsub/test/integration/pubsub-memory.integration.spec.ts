import { describe, it, expect, afterEach } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { PubSubPlugin, PUBSUB_SERVICE, Subscribe, type IPubSubService, type IPubSubMessage } from '../../src';

/**
 * End-to-end validation on the in-memory driver — NO Redis. Exercises the full
 * stack (plugin -> dedicated subscriber client -> driver events -> dispatch)
 * through production code; the memory driver's process-global bus mirrors
 * single-node Redis Pub/Sub delivery.
 */

const received: IPubSubMessage[] = [];

@Injectable()
class UserEventsHandler {
  @Subscribe('user.created')
  onCreated(message: IPubSubMessage<{ id: number }>): void {
    received.push(message);
  }

  @Subscribe({ pattern: 'order.*' })
  onOrder(message: IPubSubMessage): void {
    received.push(message);
  }
}

async function boot(channelPrefix = ''): Promise<TestingModule> {
  const app = await Test.createTestingModule({
    imports: [
      RedisModule.forRoot({
        clients: { type: 'single', host: 'x', port: 1 },
        global: { driver: MEMORY_DRIVER_TYPE },
        plugins: [new PubSubPlugin({ channelPrefix })],
      }),
    ],
    providers: [UserEventsHandler],
  }).compile();
  await app.init();
  return app;
}

const until = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('PubSub on the in-memory driver (no Redis)', () => {
  let app: TestingModule | undefined;

  afterEach(async () => {
    received.length = 0;
    await app?.close();
    app = undefined;
  });

  it('round-trips a typed message: publish -> dedicated subscriber -> handler', async () => {
    // Given
    app = await boot();
    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);
    const got: IPubSubMessage[] = [];
    await pubsub.subscribe<{ n: number }>('metrics.tick', (msg) => {
      got.push(msg);
    });

    // When
    const receivers = await pubsub.publish('metrics.tick', { n: 1 });
    await until(() => got.length > 0);

    // Then
    expect(receivers).toBeGreaterThanOrEqual(1);
    expect(got[0]).toMatchObject({ channel: 'metrics.tick', data: { n: 1 } });
  });

  it('@Subscribe handlers are auto-discovered for channels AND patterns', async () => {
    // Given
    app = await boot();
    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);

    // When
    await pubsub.publish('user.created', { id: 5 });
    await pubsub.publish('order.paid', { total: 10 });
    await until(() => received.length >= 2);

    // Then — channel handler got the typed payload; pattern handler got both fields
    const created = received.find((m) => m.channel === 'user.created');
    const order = received.find((m) => m.channel === 'order.paid');
    expect(created?.data).toEqual({ id: 5 });
    expect(order?.pattern).toBe('order.*');
  });

  it('applies the channelPrefix transparently (logical names in handlers)', async () => {
    // Given
    app = await boot('app:');
    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);
    const got: IPubSubMessage[] = [];
    await pubsub.subscribe('greeting', (msg) => {
      got.push(msg);
    });

    // When
    await pubsub.publish('greeting', 'hello');
    await until(() => got.length > 0);

    // Then — prefix is invisible to handlers
    expect(got[0]).toMatchObject({ channel: 'greeting', data: 'hello' });
  });

  it('unsubscribe stops delivery', async () => {
    // Given
    app = await boot();
    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);
    const got: unknown[] = [];
    const subscription = await pubsub.subscribe('temp', (msg) => {
      got.push(msg.data);
    });
    await pubsub.publish('temp', 1);
    await until(() => got.length === 1);

    // When
    await subscription.unsubscribe();
    await pubsub.publish('temp', 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then
    expect(got).toEqual([1]);
  });

  it('getSubscriptions reports the discovered handlers', async () => {
    // Given
    app = await boot();
    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);

    // When / Then
    const snapshot = pubsub.getSubscriptions();
    expect(snapshot.channels).toContain('user.created');
    expect(snapshot.patterns).toContain('order.*');
  });
});
