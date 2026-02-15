---
title: 'Compatibility Matrix — NestJS RedisX'
description: 'Supported versions of Node.js, NestJS, Redis, and Redis drivers for NestJS RedisX.'
---

# Compatibility Matrix

## Support Tiers

- **Supported** — Tested in CI matrix, bugs are treated as high priority
- **Best effort** — May work, not tested in CI, community PRs accepted
- **Not supported** — Known incompatibilities, not planned

## Runtime Compatibility

| | Node 18 | Node 20 | Node 22 |
|---|---------|---------|---------|
| NestJS 11 | Supported | Supported | Best effort |
| NestJS 10 | Supported | Supported | Best effort |
| NestJS 9 | Best effort | Best effort | Not supported |

NestJS 9 is EOL and not covered by CI. It may work but is best-effort only.

## Redis Compatibility

| | Redis 6.2 | Redis 7.x |
|---|-----------|-----------|
| Standalone | Supported | Supported |
| Sentinel | Supported | Supported |
| Cluster | Supported | Supported |

Redis 6.2 is the minimum version required for Lua scripting features used by locks, rate-limit, and idempotency packages.

## Driver Compatibility

| Driver | Status | Notes |
|--------|--------|-------|
| ioredis (recommended) | Supported | Primary driver, most tested |
| node-redis | Supported | Feature parity for supported topologies via driver abstraction |

ioredis is the recommended driver due to mature Cluster and Sentinel support and wider community adoption. The driver abstraction layer provides feature parity for supported topologies. For Docker Sentinel behind NAT, ioredis is recommended.

## Peer Dependencies

| Dependency | Minimum | Recommended |
|------------|---------|-------------|
| Node.js | 18.0.0 | 20.x LTS |
| @nestjs/common | 10.0.0 | 11.x |
| @nestjs/core | 10.0.0 | 11.x |
| ioredis | 5.0.0 | 5.9+ |
| redis (node-redis) | 4.6.0 | 4.7+ |
| reflect-metadata | 0.2.0 | 0.2.x |
| rxjs | 7.8.0 | 7.8+ |

## Plugin-Specific Dependencies

Plugin packages additionally require `@nestjs-redisx/core` as a peer dependency.

| Plugin | Extra Dependencies |
|--------|--------------------|
| metrics | depends on `prom-client` |
| tracing | depends on `@opentelemetry/api` (+ optional SDK packages depending on exporter) |

All other plugins (cache, locks, rate-limit, idempotency, streams) have no additional production dependencies beyond core and NestJS.

## Known Limitations

1. Redis Cluster requires Redis 6.2+ and at least 3 master nodes
2. Redis Sentinel requires Redis 6.2+ with a sentinel-aware topology
3. Lua scripts used by locks, rate-limit, and idempotency require Redis 6.2+ for `EVALSHA` with script preloading
4. node-redis Sentinel support is limited compared to ioredis
5. Redis Cluster multi-key commands require hash tags `{...}` to avoid CROSSSLOT errors
6. Lua scripts in Cluster must operate on keys within the same hash slot (RedisX uses hash tags for this)
