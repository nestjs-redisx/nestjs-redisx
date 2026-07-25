/**
 * In-process Pub/Sub bus shared by ALL memory driver instances.
 *
 * Real Redis delivers published messages to every subscribed connection of the
 * server. Memory adapters each own an isolated keyspace, but Pub/Sub must span
 * "connections" (e.g. a plugin's dedicated subscriber client and the default
 * publisher client), so the bus is module-global — mirroring the single-node
 * semantics the memory driver already documents.
 */

import { globToRegExp } from '../glob';

type MessageListener = (channel: string, message: string) => void;
type PatternListener = (pattern: string, channel: string, message: string) => void;

interface ISubscriber {
  onMessage: MessageListener;
  onPMessage: PatternListener;
}

export { globToRegExp };

class MemoryPubSubBus {
  private readonly channelSubs = new Map<string, Map<ISubscriber, true>>();
  private readonly patternSubs = new Map<string, Map<ISubscriber, RegExp>>();

  subscribe(subscriber: ISubscriber, channel: string): void {
    let subs = this.channelSubs.get(channel);
    if (!subs) {
      subs = new Map();
      this.channelSubs.set(channel, subs);
    }
    subs.set(subscriber, true);
  }

  unsubscribe(subscriber: ISubscriber, channels: string[]): void {
    const targets = channels.length > 0 ? channels : [...this.channelSubs.keys()];
    for (const channel of targets) {
      const subs = this.channelSubs.get(channel);
      subs?.delete(subscriber);
      if (subs?.size === 0) {
        this.channelSubs.delete(channel);
      }
    }
  }

  psubscribe(subscriber: ISubscriber, pattern: string): void {
    let subs = this.patternSubs.get(pattern);
    if (!subs) {
      subs = new Map();
      this.patternSubs.set(pattern, subs);
    }
    subs.set(subscriber, globToRegExp(pattern));
  }

  punsubscribe(subscriber: ISubscriber, patterns: string[]): void {
    const targets = patterns.length > 0 ? patterns : [...this.patternSubs.keys()];
    for (const pattern of targets) {
      const subs = this.patternSubs.get(pattern);
      subs?.delete(subscriber);
      if (subs?.size === 0) {
        this.patternSubs.delete(pattern);
      }
    }
  }

  /** Delivers to channel and matching pattern subscribers; returns receiver count. */
  publish(channel: string, message: string): number {
    let receivers = 0;

    const direct = this.channelSubs.get(channel);
    if (direct) {
      for (const subscriber of direct.keys()) {
        receivers++;
        // Async delivery like real Redis (never re-entrant into publish()).
        queueMicrotask(() => subscriber.onMessage(channel, message));
      }
    }

    for (const [pattern, subs] of this.patternSubs) {
      for (const [subscriber, regex] of subs) {
        if (regex.test(channel)) {
          receivers++;
          queueMicrotask(() => subscriber.onPMessage(pattern, channel, message));
        }
      }
    }

    return receivers;
  }

  /** Removes a subscriber everywhere (called on disconnect). */
  removeSubscriber(subscriber: ISubscriber): void {
    this.unsubscribe(subscriber, []);
    this.punsubscribe(subscriber, []);
  }

  /** Test helper: drop every subscription (keeps suites isolated). */
  reset(): void {
    this.channelSubs.clear();
    this.patternSubs.clear();
  }
}

/** Module-global bus shared by every MemoryRedisAdapter instance. */
export const memoryPubSubBus = new MemoryPubSubBus();

export type { ISubscriber as IMemoryPubSubSubscriber };
