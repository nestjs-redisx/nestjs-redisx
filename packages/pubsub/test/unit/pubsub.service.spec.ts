import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { EventEmitter } from 'events';
import { DriverEvent, type IRedisDriver } from '@nestjs-redisx/core';
import { PubSubService } from '../../src/pubsub/application/services/pubsub.service';
import { PubSubPublishError, PubSubSubscribeError } from '../../src/shared/errors';
import type { IPubSubMessage, IPubSubPluginOptions } from '../../src/shared/types';

/** Subscriber driver stub: spies + a real emitter to simulate deliveries. */
function createSubscriberStub() {
  const emitter = new EventEmitter();
  return {
    emitter,
    driver: {
      on: vi.fn((event: DriverEvent, handler: (...args: unknown[]) => void) => emitter.on(event, handler)),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      psubscribe: vi.fn().mockResolvedValue(undefined),
      punsubscribe: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<IRedisDriver>,
  };
}

function createPublisherStub(): MockedObject<IRedisDriver> {
  return { publish: vi.fn().mockResolvedValue(2) } as unknown as MockedObject<IRedisDriver>;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('PubSubService', () => {
  let publisher: MockedObject<IRedisDriver>;
  let sub: ReturnType<typeof createSubscriberStub>;
  let service: PubSubService;
  let options: IPubSubPluginOptions;

  function build(opts: IPubSubPluginOptions = {}): PubSubService {
    options = { channelPrefix: '', ...opts };
    publisher = createPublisherStub();
    sub = createSubscriberStub();
    return new PubSubService(options, publisher, sub.driver);
  }

  beforeEach(() => {
    service = build();
  });

  describe('publish', () => {
    it('should JSON-serialize the payload and return the receiver count', async () => {
      // When
      const receivers = await service.publish('user.created', { id: 42 });

      // Then
      expect(receivers).toBe(2);
      expect(publisher.publish).toHaveBeenCalledWith('user.created', '{"id":42}');
    });

    it('should apply the channelPrefix', async () => {
      // Given
      service = build({ channelPrefix: 'app:' });

      // When
      await service.publish('user.created', 1);

      // Then
      expect(publisher.publish).toHaveBeenCalledWith('app:user.created', '1');
    });

    it('should serialize undefined as null', async () => {
      // When
      await service.publish('ping', undefined);

      // Then
      expect(publisher.publish).toHaveBeenCalledWith('ping', 'null');
    });

    it('should wrap serialization failures in PubSubPublishError', async () => {
      // Given — a circular structure
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // When / Then
      await expect(service.publish('bad', circular)).rejects.toBeInstanceOf(PubSubPublishError);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('should wrap transport failures in PubSubPublishError', async () => {
      // Given
      publisher.publish.mockRejectedValue(new Error('conn reset'));

      // When / Then
      await expect(service.publish('ch', 1)).rejects.toBeInstanceOf(PubSubPublishError);
    });
  });

  describe('subscribe & dispatch', () => {
    it('should subscribe on the dedicated driver and deliver a typed message', async () => {
      // Given
      const received: IPubSubMessage[] = [];
      await service.subscribe('user.created', (msg) => {
        received.push(msg);
      });
      expect(sub.driver.subscribe).toHaveBeenCalledWith('user.created');

      // When — the driver delivers a message
      sub.emitter.emit(DriverEvent.MESSAGE, 'user.created', '{"id":7}');
      await flush();

      // Then
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ channel: 'user.created', data: { id: 7 }, raw: '{"id":7}' });
      expect(received[0]!.pattern).toBeUndefined();
    });

    it('should multiplex handlers locally: one Redis SUBSCRIBE per channel', async () => {
      // Given
      const first = vi.fn();
      const second = vi.fn();

      // When
      await service.subscribe('ch', first);
      await service.subscribe('ch', second);
      sub.emitter.emit(DriverEvent.MESSAGE, 'ch', '"x"');
      await flush();

      // Then — one underlying subscription, both handlers called
      expect(sub.driver.subscribe).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('should deliver the raw string when the payload is not JSON', async () => {
      // Given
      const received: IPubSubMessage[] = [];
      await service.subscribe('legacy', (msg) => {
        received.push(msg);
      });

      // When — a non-RedisX publisher sent a plain string
      sub.emitter.emit(DriverEvent.MESSAGE, 'legacy', 'plain-text');
      await flush();

      // Then — fail-open delivery
      expect(received[0]!.data).toBe('plain-text');
      expect(received[0]!.raw).toBe('plain-text');
    });

    it('should isolate handler failures (sync throw and async rejection)', async () => {
      // Given — a bad sync handler, a bad async handler, and a good one
      const good = vi.fn();
      await service.subscribe('ch', () => {
        throw new Error('sync boom');
      });
      await service.subscribe('ch', async () => {
        throw new Error('async boom');
      });
      await service.subscribe('ch', good);

      // When
      sub.emitter.emit(DriverEvent.MESSAGE, 'ch', '1');
      await flush();

      // Then — the good handler still ran; nothing crashed
      expect(good).toHaveBeenCalledTimes(1);
    });

    it('should strip the channelPrefix from the delivered message', async () => {
      // Given
      service = build({ channelPrefix: 'app:' });
      const received: IPubSubMessage[] = [];
      await service.subscribe('user.created', (msg) => {
        received.push(msg);
      });
      expect(sub.driver.subscribe).toHaveBeenCalledWith('app:user.created');

      // When — driver delivers with the FULL channel name
      sub.emitter.emit(DriverEvent.MESSAGE, 'app:user.created', '1');
      await flush();

      // Then — the handler sees the logical name
      expect(received[0]!.channel).toBe('user.created');
    });

    it('should wrap SUBSCRIBE failures and register no phantom handler', async () => {
      // Given
      sub.driver.subscribe.mockRejectedValue(new Error('down'));

      // When / Then
      await expect(service.subscribe('ch', vi.fn())).rejects.toBeInstanceOf(PubSubSubscribeError);
      expect(service.getSubscriptions().channels).toEqual([]);
    });
  });

  describe('pattern subscriptions', () => {
    it('should psubscribe and deliver messages with pattern + concrete channel', async () => {
      // Given
      const received: IPubSubMessage[] = [];
      await service.psubscribe('user.*', (msg) => {
        received.push(msg);
      });
      expect(sub.driver.psubscribe).toHaveBeenCalledWith('user.*');

      // When
      sub.emitter.emit(DriverEvent.PMESSAGE, 'user.*', 'user.created', '{"id":1}');
      await flush();

      // Then
      expect(received[0]).toMatchObject({ pattern: 'user.*', channel: 'user.created', data: { id: 1 } });
    });

    it('should wrap PSUBSCRIBE failures in PubSubSubscribeError', async () => {
      // Given
      sub.driver.psubscribe.mockRejectedValue(new Error('down'));

      // When / Then
      await expect(service.psubscribe('x.*', vi.fn())).rejects.toBeInstanceOf(PubSubSubscribeError);
    });
  });

  describe('unsubscribe lifecycle', () => {
    it('should release the Redis subscription only when the LAST handler unsubscribes', async () => {
      // Given
      const subA = await service.subscribe('ch', vi.fn());
      const subB = await service.subscribe('ch', vi.fn());

      // When — first handler leaves: subscription stays
      await subA.unsubscribe();
      expect(sub.driver.unsubscribe).not.toHaveBeenCalled();

      // When — last handler leaves: released
      await subB.unsubscribe();
      expect(sub.driver.unsubscribe).toHaveBeenCalledWith('ch');
      expect(service.getSubscriptions().channels).toEqual([]);
    });

    it('should make unsubscribe idempotent', async () => {
      // Given
      const subscription = await service.subscribe('ch', vi.fn());

      // When
      await subscription.unsubscribe();
      await subscription.unsubscribe();

      // Then — released exactly once
      expect(sub.driver.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('should stop delivering after unsubscribe', async () => {
      // Given
      const handler = vi.fn();
      const subscription = await service.subscribe('ch', handler);
      await subscription.unsubscribe();

      // When — a late message arrives (e.g. in flight during unsubscribe)
      sub.emitter.emit(DriverEvent.MESSAGE, 'ch', '1');
      await flush();

      // Then
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribeAll should clear everything and release channels and patterns', async () => {
      // Given
      await service.subscribe('a', vi.fn());
      await service.subscribe('b', vi.fn());
      await service.psubscribe('p.*', vi.fn());

      // When
      await service.unsubscribeAll();

      // Then
      expect(sub.driver.unsubscribe).toHaveBeenCalledWith('a', 'b');
      expect(sub.driver.punsubscribe).toHaveBeenCalledWith('p.*');
      expect(service.getSubscriptions()).toEqual({ channels: [], patterns: [] });
    });

    it('onModuleDestroy should unsubscribe everything (shutdown hygiene)', async () => {
      // Given
      await service.subscribe('a', vi.fn());

      // When
      await service.onModuleDestroy();

      // Then
      expect(sub.driver.unsubscribe).toHaveBeenCalledWith('a');
    });

    it('should tolerate driver release failures on unsubscribe (log-only)', async () => {
      // Given
      sub.driver.unsubscribe.mockRejectedValue(new Error('gone'));
      const subscription = await service.subscribe('ch', vi.fn());

      // When / Then — no throw
      await expect(subscription.unsubscribe()).resolves.toBeUndefined();
    });
  });

  describe('getSubscriptions', () => {
    it('should report logical (prefix-stripped) channels and patterns', async () => {
      // Given
      service = build({ channelPrefix: 'app:' });
      await service.subscribe('user.created', vi.fn());
      await service.psubscribe('order.*', vi.fn());

      // When / Then
      expect(service.getSubscriptions()).toEqual({ channels: ['user.created'], patterns: ['order.*'] });
    });
  });
});
