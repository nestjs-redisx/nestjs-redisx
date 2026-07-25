---
title: 'Service API — Pub/Sub Plugin | NestJS RedisX'
description: 'Programmatic Redis Pub/Sub with IPubSubService: publish, subscribe, psubscribe, subscription handles, unsubscribeAll, and getSubscriptions.'
---

# Service API

Inject `PUBSUB_SERVICE` for programmatic control.

<<< @/apps/demo/src/plugins/pubsub/service-subscribe.usage.ts{typescript}

## `IPubSubService`

- `publish<T>(channel, data): Promise<number>` — JSON-serializes and publishes; returns the number of subscribers that received the message. Throws `PubSubPublishError` on serialization or transport failure.
- `subscribe<T>(channel, handler): Promise<IPubSubSubscription>` — registers a handler; the Redis subscription is created for the first handler and shared by the rest. Throws `PubSubSubscribeError` when SUBSCRIBE fails (no phantom handler is left behind).
- `psubscribe<T>(pattern, handler): Promise<IPubSubSubscription>` — pattern subscription (`*`, `?`, `[..]`); messages carry both `pattern` and the concrete `channel`.
- `unsubscribeAll(): Promise<void>` — removes every handler and releases all Redis subscriptions (called automatically on module destroy).
- `getSubscriptions(): { channels, patterns }` — non-mutating snapshot of logical names for monitoring/health.

### Subscription handles

`unsubscribe()` on the returned handle removes that handler; when it was the last one for the channel/pattern, the underlying Redis subscription is released too. Calling it twice is safe.

A given handler **function** is registered at most once per channel: subscribing the same function to the same channel again is a no-op that returns a handle over the same registration (use separate closures if you need independent subscriptions). Concurrent `subscribe`/`unsubscribe` calls for the same channel are serialized internally, so the local handler registry can never desync from the Redis subscription state.

::: tip Delivery semantics
Pub/Sub is at-most-once and non-persistent: `publish` returns `0` when nobody is subscribed, and messages sent while an instance is disconnected are lost. Use [Streams](../streams/) when you need durability.
:::
