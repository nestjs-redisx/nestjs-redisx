import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryPubSubBus, globToRegExp, type IMemoryPubSubSubscriber } from '../../src/memory/domain/pubsub/memory-pubsub-bus';

function createSubscriber(): IMemoryPubSubSubscriber & { messages: unknown[][]; pmessages: unknown[][] } {
  const messages: unknown[][] = [];
  const pmessages: unknown[][] = [];
  return {
    messages,
    pmessages,
    onMessage: (channel, message) => messages.push([channel, message]),
    onPMessage: (pattern, channel, message) => pmessages.push([pattern, channel, message]),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('globToRegExp', () => {
  it.each([
    ['user.*', 'user.created', true],
    ['user.*', 'order.created', false],
    ['user.?', 'user.a', true],
    ['user.?', 'user.ab', false],
    ['news.[ab]', 'news.a', true],
    ['news.[ab]', 'news.c', false],
    ['exact', 'exact', true],
    ['exact', 'exact2', false],
    ['a+b(c)', 'a+b(c)', true], // regex specials are escaped
  ])('pattern %s vs channel %s -> %s', (pattern, channel, expected) => {
    expect(globToRegExp(pattern).test(channel)).toBe(expected);
  });

  it('treats an unclosed bracket literally', () => {
    expect(globToRegExp('a[b').test('a[b')).toBe(true);
  });
});

describe('memoryPubSubBus', () => {
  beforeEach(() => {
    memoryPubSubBus.reset();
  });

  it('delivers to channel subscribers and returns the receiver count', async () => {
    // Given
    const sub = createSubscriber();
    memoryPubSubBus.subscribe(sub, 'ch');

    // When
    const receivers = memoryPubSubBus.publish('ch', 'payload');
    await flush();

    // Then
    expect(receivers).toBe(1);
    expect(sub.messages).toEqual([['ch', 'payload']]);
  });

  it('delivers to matching pattern subscribers with the pattern name', async () => {
    // Given
    const sub = createSubscriber();
    memoryPubSubBus.psubscribe(sub, 'user.*');

    // When
    const receivers = memoryPubSubBus.publish('user.created', 'x');
    memoryPubSubBus.publish('order.created', 'y'); // no match
    await flush();

    // Then
    expect(receivers).toBe(1);
    expect(sub.pmessages).toEqual([['user.*', 'user.created', 'x']]);
  });

  it('spans multiple subscribers (separate adapters) like single-node Redis', async () => {
    // Given — two independent "connections"
    const a = createSubscriber();
    const b = createSubscriber();
    memoryPubSubBus.subscribe(a, 'ch');
    memoryPubSubBus.subscribe(b, 'ch');

    // When
    const receivers = memoryPubSubBus.publish('ch', 'msg');
    await flush();

    // Then
    expect(receivers).toBe(2);
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(1);
  });

  it('unsubscribe with explicit channels and with empty list (= all)', async () => {
    // Given
    const sub = createSubscriber();
    memoryPubSubBus.subscribe(sub, 'a');
    memoryPubSubBus.subscribe(sub, 'b');

    // When — explicit
    memoryPubSubBus.unsubscribe(sub, ['a']);
    memoryPubSubBus.publish('a', '1');
    memoryPubSubBus.publish('b', '2');
    await flush();

    // Then
    expect(sub.messages).toEqual([['b', '2']]);

    // When — empty list removes the rest
    memoryPubSubBus.unsubscribe(sub, []);
    memoryPubSubBus.publish('b', '3');
    await flush();
    expect(sub.messages).toHaveLength(1);
  });

  it('removeSubscriber drops channel AND pattern subscriptions (disconnect)', async () => {
    // Given
    const sub = createSubscriber();
    memoryPubSubBus.subscribe(sub, 'ch');
    memoryPubSubBus.psubscribe(sub, 'p.*');

    // When
    memoryPubSubBus.removeSubscriber(sub);
    memoryPubSubBus.publish('ch', 'x');
    memoryPubSubBus.publish('p.q', 'y');
    await flush();

    // Then
    expect(sub.messages).toHaveLength(0);
    expect(sub.pmessages).toHaveLength(0);
  });

  it('publish with no subscribers returns 0', () => {
    expect(memoryPubSubBus.publish('empty', 'x')).toBe(0);
  });

  it('delivery is asynchronous (never re-entrant into publish)', () => {
    // Given
    const order: string[] = [];
    const sub: IMemoryPubSubSubscriber = {
      onMessage: () => order.push('delivered'),
      onPMessage: vi.fn(),
    };
    memoryPubSubBus.subscribe(sub, 'ch');

    // When
    memoryPubSubBus.publish('ch', 'x');
    order.push('after-publish');

    // Then — publish returned before delivery ran
    expect(order).toEqual(['after-publish']);
  });
});
