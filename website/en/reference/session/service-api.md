---
title: 'Service API — Session Plugin | NestJS RedisX'
description: 'ISessionService reference: getSession, getSessionsByUser, count, countByUser, revoke, revokeAll, revokeAllExcept, recordActivity.'
---

# Service API

Inject the service with the `SESSION_SERVICE` token; pass your payload shape as the generic:

```typescript
constructor(
  @Inject(SESSION_SERVICE) private readonly sessions: ISessionService<AppSession>,
) {}
```

## Introspection

### `getSession(sessionId)`

Returns `ISessionInfo<T> | null` — the parsed middleware payload plus plugin metadata. Reading a session enforces the absolute lifetime cap (a capped-out session is destroyed and reported as `null`).

```typescript
const info = await sessions.getSession(req.sessionID);
// info.data      -> your payload (typed T)
// info.metadata  -> { userId?, ip?, userAgent?, createdAt, lastSeenAt, expiresAt } | null
```

### `getSessionsByUser(userId)`

The device page: every live session of a user, with metadata.

<<< @/apps/demo/src/plugins/session/device-page.usage.ts{typescript}

### `count()` / `countByUser(userId)`

Live totals from the global / per-user index. Expired entries are swept by score before counting, so numbers stay accurate as sessions expire naturally.

## Revocation

### `revoke(sessionId)`

Terminates one session; returns `true` when a session existed. The owner's next request is treated as unauthenticated.

### `revokeAll(userId)`

Password change / compromise response — terminates every session of the user; returns the number revoked.

### `revokeAllExcept(userId, currentSessionId)`

The real product button: "log out everywhere else". A naked `revokeAll` logs out the clicker too.

<<< @/apps/demo/src/plugins/session/revoke-sessions.usage.ts{typescript}

## Activity

### `recordActivity(sessionId, { ip?, userAgent? })`

Stamps request-scoped attributes onto the session metadata and refreshes `lastSeenAt`. No-op for missing sessions. See [Store Adapters — Activity Stamping](/en/reference/session/store-adapters#activity-stamping) for the middleware one-liner.

## Errors

All errors extend `SessionError` (which extends `RedisXError`):

| Error | Code | When |
|-------|------|------|
| `SessionStoreError` | `SESSION_STORE_ERROR` | Redis/Lua failure in any store operation |
| `InvalidSessionConfigError` | `SESSION_CONFIG_INVALID` | Invalid plugin options (thrown at bootstrap) |
| `SessionLimitExceededError` | `SESSION_LIMIT_EXCEEDED` | Seat limit hit under the `reject` policy |
| `SessionMiddlewareMissingError` | `SESSION_MIDDLEWARE_MISSING` | `toExpressStore()` without `express-session` installed |
| `SessionSerializationError` | `SESSION_SERIALIZATION_FAILED` | Payload not JSON-serializable |
