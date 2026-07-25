---
title: 'Troubleshooting — Pub/Sub Plugin | NestJS RedisX'
description: 'Fix common NestJS Redis Pub/Sub issues: missed messages, zero receivers, driver/topology limits, and handler errors.'
---

# Troubleshooting

## Messages are missed

Pub/Sub is **not persistent**: only connections subscribed at the exact moment of publishing receive the message. Messages published while an instance was restarting/disconnected are gone. If you need durability or replay, use the [Streams plugin](../streams/).

## `publish` returns 0

Nobody was subscribed to that channel on the Redis server at that moment. Check `getSubscriptions()` on the consumer side and remember `channelPrefix`: a publisher with prefix `'app:'` and a subscriber without it are on different channels.

## Handlers never fire

- Ensure the handler class is a **provider** (registered in a module) — `@Subscribe` discovery scans providers only.
- The plugin logs `Subscribed X.y to channel "…"` on startup for every discovered handler; if the line is missing, the metadata was not found.
- With a custom `keyExtractor`-style setup, verify the channel names match exactly (prefix included).

## node-redis + Cluster/Sentinel

The node-redis adapter supports Pub/Sub on single-node connections only; SUBSCRIBE on cluster/sentinel throws a descriptive error. Use the `ioredis` driver for Pub/Sub over those topologies.

## One bad handler

Handler exceptions (sync and async) are caught, logged, and counted (`redisx_pubsub_handler_errors_total` when the Metrics plugin is present) — they never affect other handlers or the subscriber connection.
