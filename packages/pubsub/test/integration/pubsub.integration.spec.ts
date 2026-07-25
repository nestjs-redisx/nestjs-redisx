import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { PubSubPlugin, PUBSUB_SERVICE, Subscribe, type IPubSubService, type IPubSubMessage } from '../../src';

/**
 * Integration tests against a LIVE Redis instance: TWO independent Nest
 * applications sharing one Redis — instance A publishes, instance B receives
 * through its dedicated subscriber connection (true cross-instance delivery,
 * ioredis driver, real SUBSCRIBE/PSUBSCRIBE).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const decoratorReceived: IPubSubMessage[] = [];

@Injectable()
class EventsHandler {
  @Subscribe('itest.user.created')
  onUserCreated(message: IPubSubMessage<{ id: number }>): void {
    decoratorReceived.push(message);
  }

  @Subscribe({ pattern: 'itest.order.*' })
  onOrderEvent(message: IPubSubMessage): void {
    decoratorReceived.push(message);
  }
}

async function bootApp(withHandlers: boolean): Promise<TestingModule> {
  const app = await Test.createTestingModule({
    imports: [
      RedisModule.forRoot({
        clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
        plugins: [new PubSubPlugin()],
      }),
    ],
    providers: withHandlers ? [EventsHandler] : [],
  }).compile();
  await app.init();
  return app;
}

const until = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describeIntegration('PubSub — cross-instance delivery (live Redis)', () => {
  let publisherApp: TestingModule;
  let subscriberApp: TestingModule;
  let publisherSide: IPubSubService;
  let subscriberSide: IPubSubService;

  beforeAll(async () => {
    subscriberApp = await bootApp(true); // subscribes first
    publisherApp = await bootApp(false);
    publisherSide = publisherApp.get<IPubSubService>(PUBSUB_SERVICE);
    subscriberSide = subscriberApp.get<IPubSubService>(PUBSUB_SERVICE);
  });

  beforeEach(() => {
    decoratorReceived.length = 0;
  });

  afterAll(async () => {
    await publisherApp?.close();
    await subscriberApp?.close();
  });

  it('delivers a typed message from instance A to instance B (service subscribe)', async () => {
    // Given — B subscribes programmatically
    const got: IPubSubMessage[] = [];
    const subscription = await subscriberSide.subscribe<{ n: number }>('itest.metrics', (msg) => {
      got.push(msg);
    });

    // When — A publishes
    const receivers = await publisherSide.publish('itest.metrics', { n: 42 });
    await until(() => got.length > 0);

    // Then — real cross-instance delivery, at least B's subscriber received it
    expect(receivers).toBeGreaterThanOrEqual(1);
    expect(got[0]).toMatchObject({ channel: 'itest.metrics', data: { n: 42 } });

    await subscription.unsubscribe();
  });

  it('@Subscribe handlers on instance B receive channel and pattern messages from A', async () => {
    // When
    await publisherSide.publish('itest.user.created', { id: 7 });
    await publisherSide.publish('itest.order.paid', { total: 99 });
    await until(() => decoratorReceived.length >= 2);

    // Then
    const created = decoratorReceived.find((m) => m.channel === 'itest.user.created');
    const order = decoratorReceived.find((m) => m.channel === 'itest.order.paid');
    expect(created?.data).toEqual({ id: 7 });
    expect(order?.pattern).toBe('itest.order.*');
  });

  it('unsubscribe stops cross-instance delivery', async () => {
    // Given
    const got: unknown[] = [];
    const subscription = await subscriberSide.subscribe('itest.temp', (msg) => {
      got.push(msg.data);
    });
    await publisherSide.publish('itest.temp', 1);
    await until(() => got.length === 1);

    // When
    await subscription.unsubscribe();
    await publisherSide.publish('itest.temp', 2);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Then
    expect(got).toEqual([1]);
  });

  it('publish reports zero receivers when nobody is subscribed', async () => {
    // When
    const receivers = await publisherSide.publish('itest.nobody-listens', 'x');

    // Then
    expect(receivers).toBe(0);
  });

  it('the publisher connection still executes regular commands (subscriptions live on a dedicated connection)', async () => {
    // Given — B has active subscriptions from the tests above / decorators
    // When / Then — publishing (a regular command) keeps working on B too:
    // its main client is NOT in subscriber mode.
    await expect(subscriberSide.publish('itest.self-check', 'ok')).resolves.toBeGreaterThanOrEqual(0);
  });
});
