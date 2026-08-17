---
title: 'Security Policies — Session Plugin | NestJS RedisX'
description: 'Per-user seat limits (reject / evict-oldest) and the absolute lifetime cap: the compliance controls express-session alone cannot enforce.'
---

# Security Policies

<<< @/apps/demo/src/plugins/session/security-policies.setup.ts{typescript}

## Seat Limits (`maxSessionsPerUser`)

Banking apps, licensed B2B seats, and streaming services all limit concurrent sessions per user. The limit is enforced at the `set` that first indexes a session for a user — with Passport that is the login save.

### `'evict-oldest'` (default)

The oldest session (by `createdAt`) over the limit is destroyed. The evicted device's next request is unauthenticated; the login that triggered the eviction succeeds silently. Eviction fires the `onRevoked` event, so the signed-out device can be told why.

### `'reject'`

The new session is refused with `SessionLimitExceededError` and **nothing is written** — the reservation is an atomic per-user Lua script, so two racing logins cannot both slip in. The error surfaces through the middleware's save callback (with Passport: the `req.logIn` callback), where you map it to an HTTP response:

```typescript
// Express error handler
app.use((err, req, res, next) => {
  if (err instanceof SessionLimitExceededError) {
    return res.status(409).json({ error: 'Too many active sessions. Sign out another device first.' });
  }
  next(err);
});
```

Re-saving an existing session is never rejected — only new seats count.

## Absolute Lifetime Cap (`absoluteLifetimeMs`)

Idle timeout (rolling `maxAge`) is the middleware's job. What the middleware **cannot** express is *"force re-login every 12 hours regardless of activity"* — a standard PCI DSS / OWASP session-management requirement. The store can, because it owns `createdAt`:

- every write/touch clamps the TTL to the remaining lifetime window, so a session dies exactly on time **even with no traffic**;
- every read/touch checks the cap, so a session that predates a newly-tightened cap is destroyed on its next access (firing `onExpiredByCap`);
- `createdAt` survives re-saves — activity never extends the absolute window.

```
login                    cap = 12h
  |—— active, rolling 1h TTL slides ——————————————|
  t=0                                          t=12h: destroyed,
                                               regardless of activity
```

## Consistency Notes

- The `reject` reservation is atomic per user (single-key Lua — cluster-safe), its expiry score is clamped to the absolute lifetime cap (a capped-out session frees its seat on time), and a reservation whose session write fails is released again — a connection blip never burns a seat.
- `evict-oldest` is a best-effort cross-key sequence: concurrent logins can transiently overshoot the limit by the number of in-flight requests.
- Index entries are swept lazily by expiry score, and index keys carry their own TTL (refreshed on every save AND touch, so rolling sessions never outlive their index); a crashed process never leaves permanent garbage.
- One narrow race is accepted: a `touch` overlapping a concurrent `destroy` (or an account switch) of the same session can transiently resurrect its index entry until the entry's expiry score sweeps it (bounded by the session TTL). The consequences are contained: `getSessionsByUser` and `revokeAll` verify the owner recorded in the session's metadata, so a resurrected entry can never expose or destroy another user's session — at worst it holds a seat until it sweeps.
- **Index scores use the application clock.** Like every RedisX plugin, the store injects `Date.now()` into its Lua (the scripts never read the clock), so index expiry scores are absolute app-clock timestamps while key TTLs are relative Redis-clock. An instance whose clock is skewed by more than a session's remaining TTL can therefore write entries that other instances sweep too early (session alive but unrevocable) or too late (a seat held after the session is gone). Keep NTP running — the same assumption the rate-limit and circuit-breaker plugins make.
- Self-healing is built in: a session whose metadata was lost has its timestamps and owner re-derived on the next read (from the payload via `userIdExtractor`), `destroy` recovers the owner from the payload when the metadata is already gone, and revoking a user's sessions also clears stale index entries — so a dirty index repairs itself instead of accumulating.
