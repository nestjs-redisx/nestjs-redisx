---
title: 'Configuration — Session Plugin | NestJS RedisX'
description: 'All @nestjs-redisx/session options: keyPrefix, defaultTtlMs, userIdExtractor, absoluteLifetimeMs, maxSessionsPerUser, policies, and lifecycle events.'
---

# Configuration

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isGlobal` | `boolean` | `false` | Make the module global |
| `client` | `string` | `'default'` | Named Redis client to use |
| `keyPrefix` | `string` | `'sess:'` | Redis key namespace |
| `defaultTtlMs` | `number` | `86_400_000` (1 day) | TTL used when the middleware provides no cookie expiry |
| `userIdExtractor` | `(session: unknown) => string \| undefined` | reads `session.passport.user` | Extracts the owning user's ID from the raw payload; sessions without an ID are stored but not indexed per-user |
| `absoluteLifetimeMs` | `number` | `undefined` (off) | Absolute lifetime cap — see [Security Policies](/en/reference/session/security-policies) |
| `maxSessionsPerUser` | `number` | `undefined` (off) | Per-user seat limit |
| `maxSessionsPolicy` | `'reject' \| 'evict-oldest'` | `'evict-oldest'` | What happens at the seat limit |
| `events` | `ISessionEvents` | `undefined` | Lifecycle callbacks — see [Monitoring](/en/reference/session/monitoring) |

Configuration is validated fail-fast at bootstrap: an invalid knob throws `InvalidSessionConfigError` before the store is ever used.

## Synchronous Configuration

<<< @/apps/demo/src/plugins/session/basic-config.setup.ts{typescript}

## Async Configuration

`SessionPlugin.registerAsync()` follows the standard NestJS RedisX pattern — the plugin instance stays outside `useFactory`, the factory produces plugin options:

<<< @/apps/demo/src/plugins/session/async-config.setup.ts{typescript}

## Custom User ID Extraction

The default extractor reads the Passport convention (`session.passport.user`). For custom auth, provide your own:

```typescript
new SessionPlugin({
  userIdExtractor: (session) => (session as MySession).auth?.accountId,
});
```

Sessions for which the extractor returns `undefined` (e.g. anonymous carts) are stored normally but skipped by per-user indexing, counting, and limits.

## Named Clients

Like every RedisX plugin, the session store can run on a dedicated connection:

```typescript
RedisModule.forRoot({
  clients: {
    default: { host: 'localhost', port: 6379 },
    sessions: { host: 'localhost', port: 6379, db: 1 },
  },
  plugins: [new SessionPlugin({ client: 'sessions' })],
});
```

## Redis Keyspace

| Key | Type | Contents |
|-----|------|----------|
| `sess:{<sid>}` | STRING | Middleware payload as JSON, `PX` = session TTL |
| `sess:{<sid>}:meta` | HASH | `userId`, `ip`, `userAgent`, `createdAt`, `lastSeenAt`, `expiresAt` — same TTL, same cluster slot (hash tag) |
| `sess:user:<userId>` | ZSET | `sid -> expiresAtMs`, expired members swept lazily by score |
| `sess:index` | ZSET | Global `sid -> expiresAtMs` index behind `count()` |

::: warning Migration from connect-redis
The payload key includes a hash tag (`sess:{abc123}` rather than `sess:abc123`) so payload+metadata operations stay atomic on Redis Cluster. Existing `connect-redis` keys are therefore not picked up — users sign in again once at cutover.
:::
