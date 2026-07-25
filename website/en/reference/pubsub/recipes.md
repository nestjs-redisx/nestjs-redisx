---
title: 'Recipes — Pub/Sub Plugin | NestJS RedisX'
description: 'Practical Redis Pub/Sub patterns for NestJS: cluster-wide WebSocket broadcasting and cross-service domain events.'
---

# Recipes

## Cluster-wide WebSocket broadcast

Every instance subscribes to the same channel; publishing from anywhere reaches the sockets connected to **all** instances.

<<< @/apps/demo/src/plugins/pubsub/websocket-broadcast.usage.ts{typescript}

## Cross-service domain events

Publish domain events from write paths and let any number of services react without coupling:

<<< @/apps/demo/src/plugins/pubsub/publish.usage.ts{typescript}

Consumers subscribe by exact channel or by family via patterns:

<<< @/apps/demo/src/plugins/pubsub/subscribe-decorator.usage.ts{typescript}

## Choosing between Pub/Sub and Streams

| Need | Use |
|------|-----|
| Fire-and-forget fan-out, lowest latency | **Pub/Sub** |
| Guaranteed processing, replay, consumer groups | [Streams](../streams/) |
| Both (notify now + process reliably) | Publish to a stream, Pub/Sub-notify consumers |
