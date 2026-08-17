---
title: 'Troubleshooting — Session Plugin | NestJS RedisX'
description: 'Common @nestjs-redisx/session issues: empty device page, sessions not indexed, reject policy responses, migration from connect-redis.'
---

# Troubleshooting

## The device page is empty, but users are signed in

`getSessionsByUser()` only sees sessions the `userIdExtractor` could attribute. Check:

1. **Custom auth without Passport** — the default extractor reads `session.passport.user`. Configure `userIdExtractor` for your session shape.
2. **The session predates the plugin** — sessions written by `connect-redis` (or before the extractor was fixed) are not indexed. They index themselves on their next save.
3. **The user ID is not a string/number** — the extractor must return a non-empty string (numbers are stringified by the default extractor).

## IP / user agent columns are missing

Metadata stamping is opt-in — the store never sees the HTTP request. Add the one-liner after the session middleware ([Store Adapters — Activity Stamping](/en/reference/session/store-adapters#activity-stamping)). Note the stamper runs before your login route's effects on the *first* request — columns appear from the next request on.

## `SessionMiddlewareMissingError` at bootstrap

`toExpressStore()` lazily loads `express-session`, which is an optional peer dependency:

```bash
npm install express-session
```

## The `reject` policy returns HTTP 500

`SessionLimitExceededError` propagates through the middleware's save callback — map it in your error handler (or in the `req.logIn` callback) to a 409/429. See [Security Policies](/en/reference/session/security-policies#reject).

## Sessions logged out after migrating from connect-redis

Expected once: the payload key format includes a cluster hash tag (`sess:{sid}`), so old `sess:sid` keys are not read. Users sign in again at cutover; nothing else changes.

## `lastSeenAt` never updates

The TTL slide (and `lastSeenAt` refresh) rides the middleware's `touch`. With `express-session`, set `cookie.maxAge` and use `resave: false`; add `rolling: true` to also slide the cookie itself. With `@fastify/session`, saves happen per-request when the session changes — pair with activity stamping for a reliable `lastSeenAt`.

## Old sessions survive a newly-added lifetime cap

Sessions created before `absoluteLifetimeMs` was configured have unclamped TTLs. They are destroyed on their next read/touch (firing `onExpiredByCap`) — or by their natural TTL, whichever comes first. No action needed.

## `revokeAllExcept` logged everyone out

Pass the *current* session ID as the second argument — with express that is `req.sessionID` (not the cookie header, not the user ID).
