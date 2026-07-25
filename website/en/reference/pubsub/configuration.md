---
title: 'Configuration — Pub/Sub Plugin | NestJS RedisX'
description: 'Configure @nestjs-redisx/pubsub: named client, channel prefix, and the automatically managed dedicated subscriber connection.'
---

# Configuration

## Options

`PubSubPlugin` accepts `IPubSubPluginOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `string` | `'default'` | Named Redis client used for **publishing**. The dedicated subscriber connection is cloned from this client's config. |
| `channelPrefix` | `string` | `''` | Prefix applied to every channel and pattern. Empty by default so channels interoperate with non-RedisX publishers/subscribers. Handlers always see the logical (unprefixed) names. |

## Synchronous Setup

<<< @/apps/demo/src/plugins/pubsub/basic-config.setup.ts{typescript}

## The dedicated subscriber connection

A Redis connection in subscriber mode cannot execute regular commands. The plugin therefore creates a second client named `<client>:pubsub-subscriber` with the **same connection config and driver type** as your named client, and routes all SUBSCRIBE/PSUBSCRIBE traffic through it. Your main client keeps serving cache/locks/regular commands untouched. The connection is registered with the client manager and closed with the application.

## Driver support

| Driver | Single | Cluster | Sentinel |
|--------|--------|---------|----------|
| ioredis | ✓ | ✓ | ✓ |
| node-redis | ✓ | — | — |

With `node-redis`, Pub/Sub uses the v4 listener API and is supported on single-node connections; use `ioredis` for Pub/Sub over Cluster/Sentinel topologies.
