---
title: 'Overview — Pub/Sub Plugin | NestJS RedisX'
description: 'Typed Redis Pub/Sub for NestJS with @nestjs-redisx/pubsub: publish/subscribe, glob pattern subscriptions, @Subscribe auto-discovery, and a managed dedicated subscriber connection.'
---

# Pub/Sub Plugin

Typed Redis Pub/Sub messaging: real-time events between services and instances, WebSocket broadcasting, and cross-instance signaling — with a `@Subscribe` decorator and a dedicated subscriber connection managed for you.

## Overview

Redis Pub/Sub delivers a published message to every currently-subscribed connection — instantly, across all application instances. The catch: a Redis connection in subscriber mode cannot execute regular commands, so naive setups break their main client. This plugin clones a **dedicated subscriber connection** from your named client automatically and multiplexes any number of local handlers over it.

| Challenge | Without the plugin | With the Pub/Sub Plugin |
|-----------|--------------------|-------------------------|
| Cross-instance events | Polling or ad-hoc sockets | Instant fan-out via Redis |
| Subscriber-mode connection | Breaks the shared client | Dedicated connection, managed lifecycle |
| Handler wiring | Manual client.on('message') routing | `@Subscribe` auto-discovery + typed payloads |

## Key Features

- **Typed publish/subscribe** — JSON payloads with generics; non-JSON messages interop as raw strings
- **Pattern subscriptions** — Redis globs (`user.*`, `order.?`, `news.[ab]`) with the matching pattern delivered alongside the concrete channel
- **`@Subscribe` decorator** — provider methods auto-subscribed on startup
- **Local multiplexing** — many handlers per channel share one Redis subscription; released when the last unsubscribes
- **Channel prefixing** — optional namespace that stays invisible to handlers
- **Shutdown hygiene** — all subscriptions released on module destroy

## Installation

::: code-group

```bash [ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/pubsub ioredis
```

```bash [node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/pubsub redis
```

:::

## Basic Configuration

<<< @/apps/demo/src/plugins/pubsub/basic-config.setup.ts{typescript}

## Publishing

<<< @/apps/demo/src/plugins/pubsub/publish.usage.ts{typescript}

## Subscribing with the Decorator

<<< @/apps/demo/src/plugins/pubsub/subscribe-decorator.usage.ts{typescript}

::: warning Pub/Sub is fire-and-forget
Messages are delivered only to connections subscribed at the moment of publishing — there is no persistence, replay, or acknowledgment. For guaranteed, replayable delivery use the [Streams plugin](../streams/).
:::

## Documentation

| Topic | Description |
|-------|-------------|
| [Configuration](./configuration) | Options and the dedicated subscriber connection |
| [@Subscribe Decorator](./decorator) | Auto-discovered channel and pattern handlers |
| [Service API](./service-api) | Programmatic publish/subscribe/unsubscribe |
| [Recipes](./recipes) | WebSocket broadcast and event patterns |
| [Testing](./testing) | In-memory driver support |
| [Troubleshooting](./troubleshooting) | Delivery, drivers, and topology notes |
