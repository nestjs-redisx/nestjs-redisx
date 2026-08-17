<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/session

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/session)](https://www.npmjs.com/package/@nestjs-redisx/session)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/session)](https://www.npmjs.com/package/@nestjs-redisx/session)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/session)](https://opensource.org/licenses/MIT)

Redis session management plugin for NestJS RedisX — "Spring Session for NestJS". The base layer is a store for the session middleware you already run (`express-session` or `@fastify/session`), so Passport, `req.session`, cookies, and rolling expiry keep working untouched; migration from `connect-redis` is one line. On top of the same keys, `SESSION_SERVICE` adds what the Store contract cannot: a per-user device page, "log out everywhere (else)", seat limits, an absolute lifetime cap, and audit events.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/session ioredis
# plus your middleware: express-session OR @fastify/session
```

## Quick Example

```typescript
import { Module, Injectable, Inject } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, toExpressStore, type ISessionService, type ISessionStore } from '@nestjs-redisx/session';
import session from 'express-session';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new SessionPlugin({
          maxSessionsPerUser: 5, // seat limit
          absoluteLifetimeMs: 12 * 3600 * 1000, // force re-login every 12h (PCI/OWASP)
        }),
      ],
    }),
  ],
})
export class AppModule {}

// main.ts — one line replaces connect-redis:
const store = app.get<ISessionStore>(SESSION_STORE);
app.use(session({ secret: '...', resave: false, saveUninitialized: false, store: await toExpressStore(store) }));

// Anywhere in the app — the capabilities connect-redis cannot offer:
@Injectable()
export class SecurityService {
  constructor(@Inject(SESSION_SERVICE) private readonly sessions: ISessionService) {}

  devicePage(userId: string) {
    return this.sessions.getSessionsByUser(userId); // ip, userAgent, createdAt, lastSeenAt
  }

  logoutEverywhereElse(userId: string, currentSessionId: string) {
    return this.sessions.revokeAllExcept(userId, currentSessionId);
  }
}
```

## Features

- **Drop-in store** — implements both `express-session` and `@fastify/session` store contracts over the RedisX driver (standalone/cluster/sentinel); cookie crypto, fixation defense, and rotation stay with the battle-tested middleware.
- **Device page** — `getSessionsByUser(userId)` with metadata (IP, user agent, createdAt, lastSeenAt) via the Passport-aware `userIdExtractor` (configurable).
- **Revocation** — `revoke(sid)`, `revokeAll(userId)`, and the real product button: `revokeAllExcept(userId, currentSid)`.
- **Seat limits** — `maxSessionsPerUser` with `'reject'` (atomic per-user Lua reservation) or `'evict-oldest'`.
- **Absolute lifetime cap** — `absoluteLifetimeMs` forces re-login regardless of activity; TTLs are clamped to the remaining window, so sessions die on time even without traffic — the compliance knob idle-timeout middleware cannot provide.
- **Audit events + metrics** — `onCreated` / `onDestroyed` / `onRevoked` / `onExpiredByCap` callbacks and Prometheus counters when `MetricsPlugin` is present.
- **Testable without Redis** — runs on the `@nestjs-redisx/testing` in-memory driver, Lua included.

## Documentation

Full reference: [nestjs-redisx.dev/en/reference/session](https://nestjs-redisx.dev/en/reference/session/)

## License

MIT
