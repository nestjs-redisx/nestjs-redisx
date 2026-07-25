---
title: '@Subscribe Decorator — Pub/Sub Plugin | NestJS RedisX'
description: 'Auto-discovered Pub/Sub handlers in NestJS: @Subscribe for channels and Redis glob patterns with typed IPubSubMessage payloads.'
---

# @Subscribe Decorator

`@Subscribe` marks a provider method as a message handler. Handlers are discovered and subscribed automatically on application startup (via `DiscoveryModule`, imported by the plugin).

## Usage

<<< @/apps/demo/src/plugins/pubsub/subscribe-decorator.usage.ts{typescript}

## Forms

| Form | Meaning |
|------|---------|
| `@Subscribe('user.created')` | Exact channel subscription |
| `@Subscribe({ channel: 'user.created' })` | Same, options form |
| `@Subscribe({ pattern: 'user.*' })` | PSUBSCRIBE with a Redis glob (`*`, `?`, `[..]`) |

Passing both `channel` and `pattern` (or neither) throws at decoration time.

## The message argument

Handlers receive an `IPubSubMessage<T>`:

```typescript
interface IPubSubMessage<T = unknown> {
  channel: string; // logical channel (channelPrefix stripped)
  pattern?: string; // matching pattern (pattern subscriptions only)
  data: T; // JSON-parsed payload (raw string if not JSON)
  raw: string; // payload exactly as received
}
```

## Behaviour

- Handler errors (sync throws and async rejections) are caught and logged — one failing handler never breaks the others or the subscriber connection.
- Multiple decorated methods on any providers may target the same channel; they share one underlying Redis subscription.
- Handlers are bound to their provider instance (`this` works).
