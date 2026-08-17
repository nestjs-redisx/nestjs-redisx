---
title: 'Store Adapters — Session Plugin | NestJS RedisX'
description: 'Wire @nestjs-redisx/session into express-session with toExpressStore or @fastify/session with toFastifyStore: TTL semantics, migration from connect-redis, and typing.'
---

# Store Adapters

The promise-based `SESSION_STORE` is framework-neutral; two thin adapters translate it onto the middleware callback contracts. Everything security-critical — cookie signing, session fixation defense, ID rotation — remains the middleware's job.

## express-session

<<< @/apps/demo/src/plugins/session/express-store.setup.ts{typescript}

`toExpressStore()` is async because `express-session` is loaded lazily — it is an **optional** peer dependency, so fastify-only applications never pay for it. If the package is missing, `SessionMiddlewareMissingError` explains what to install.

Migrating from `connect-redis`:

```typescript
// Before
store: new RedisStore({ client: redisClient }),
// After — same session middleware config, RedisX-managed connection
store: await toExpressStore(app.get(SESSION_STORE)),
```

## @fastify/session

<<< @/apps/demo/src/plugins/session/fastify-store.setup.ts{typescript}

`toFastifyStore()` is synchronous and dependency-free: `@fastify/session` only consumes the returned `{ get, set, destroy }` object.

## TTL Semantics

Per write/touch, the TTL is resolved in order:

1. `cookie.expires - now` — when the middleware set an expiry (i.e. `cookie.maxAge` is configured);
2. the adapter's `ttlMs` option (`toExpressStore(store, { ttlMs })`);
3. the plugin's `defaultTtlMs` (1 day).

With `rolling: true` (express) the middleware touches the store on every request, sliding the TTL and refreshing `lastSeenAt`. A cookie that already expired is destroyed instead of written back. When `absoluteLifetimeMs` is set, every TTL is additionally clamped to the remaining lifetime window.

## Typing `req.session`

`req.session` stays middleware-owned; extend it with declaration merging (compile-time only — session contents are not validated at runtime):

```typescript
declare module 'express-session' {
  interface SessionData {
    passport?: { user?: string };
    cart?: string[];
  }
}
```

Our own API is genuinely typed via the service generic:

<<< @/apps/demo/src/plugins/session/typed-sessions.usage.ts{typescript}

## Activity Stamping

The store cannot see the HTTP request, so IP and user agent are stamped by an opt-in one-liner after the session middleware:

<<< @/apps/demo/src/plugins/session/activity-stamping.setup.ts{typescript}

`createdAt`, `lastSeenAt`, and `expiresAt` are maintained by the store itself — the stamper only adds the request-scoped columns to the device page.
