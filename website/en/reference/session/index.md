---
title: 'Overview — Session Plugin | NestJS RedisX'
description: 'Redis session management for NestJS with @nestjs-redisx/session: express-session/@fastify/session store, per-user device page, revoke everywhere, seat limits, and absolute lifetime caps.'
---

# Session Plugin

Redis session management — "Spring Session for NestJS". A drop-in store for the session middleware you already run, plus the capabilities the Store contract cannot offer: a per-user device page, "log out everywhere (else)", seat limits, an absolute lifetime cap, and audit events.

## Overview

The plugin deliberately splits responsibilities. The **store layer** implements both the `express-session` and `@fastify/session` store contracts over the RedisX driver — cookie crypto, session fixation defense, and ID rotation stay with the battle-tested middleware, and Passport, `req.session`, and the connect ecosystem keep working untouched. On top of the **same Redis keys**, `SESSION_SERVICE` maintains per-user and global indexes plus metadata, which is where the product features live.

| Challenge | With `connect-redis` | With the Session Plugin |
|-----------|----------------------|-------------------------|
| "Which devices am I signed in on?" | Impossible (opaque keys) | `getSessionsByUser()` with IP, browser, last activity |
| "Log out everywhere else" | Impossible | `revokeAllExcept(userId, currentSid)` |
| Seat limits (B2B licensing, banking) | Impossible | `maxSessionsPerUser` + `reject` / `evict-oldest` |
| "Re-login every 12h regardless of activity" (PCI DSS / OWASP) | Impossible — middleware only does idle timeout | `absoluteLifetimeMs` |
| Session audit trail | Manual | `onCreated` / `onRevoked` / `onExpiredByCap` events + Prometheus counters |

## Key Features

- **Drop-in store** — `toExpressStore()` / `toFastifyStore()` adapters; migration from `connect-redis` is one line
- **Device page** — sessions per user with metadata (IP, user agent, `createdAt`, `lastSeenAt`) via the Passport-aware `userIdExtractor`
- **Revocation** — `revoke(sid)`, `revokeAll(userId)`, `revokeAllExcept(userId, currentSid)`
- **Security policies** — per-user seat limits (atomic `reject` or `evict-oldest`) and an absolute lifetime cap with TTL clamping
- **Observability** — lifecycle event callbacks and Prometheus counters when `MetricsPlugin` is registered
- **Cluster-safe** — payload+metadata share a hash tag for atomic Lua; index operations are single-key

## Installation

::: code-group

```bash [express]
npm install @nestjs-redisx/core @nestjs-redisx/session ioredis express-session
```

```bash [fastify]
npm install @nestjs-redisx/core @nestjs-redisx/session ioredis @fastify/cookie @fastify/session
```

:::

`express-session` and `@fastify/session` are optional peer dependencies — install only the one you use.

## Basic Configuration

<<< @/apps/demo/src/plugins/session/basic-config.setup.ts{typescript}

## Wiring the Middleware

One line replaces `connect-redis`:

<<< @/apps/demo/src/plugins/session/express-store.setup.ts{typescript}

## The Device Page

<<< @/apps/demo/src/plugins/session/device-page.usage.ts{typescript}

## Log Out Everywhere Else

<<< @/apps/demo/src/plugins/session/revoke-sessions.usage.ts{typescript}

## Next Steps

- [Store Adapters](/en/reference/session/store-adapters) — express/fastify wiring, TTL semantics, migration from connect-redis
- [Configuration](/en/reference/session/configuration) — all options with defaults
- [Service API](/en/reference/session/service-api) — the full `ISessionService` reference
- [Security Policies](/en/reference/session/security-policies) — seat limits and the absolute lifetime cap
- [Monitoring](/en/reference/session/monitoring) — events and metrics
