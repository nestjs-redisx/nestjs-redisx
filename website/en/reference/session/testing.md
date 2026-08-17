---
title: 'Testing — Session Plugin | NestJS RedisX'
description: 'Test session flows without Redis using the @nestjs-redisx/testing in-memory driver — Lua scripts included.'
---

# Testing

The session store runs fully on the [`@nestjs-redisx/testing`](/en/reference/testing/) in-memory driver — including its Lua scripts — so login, device-page, revocation, and seat-limit flows are testable hermetically, with no Redis and no mocks of your own code.

## Unit / Integration Without Redis

```typescript
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';
import { SessionPlugin, SESSION_SERVICE, SESSION_STORE } from '@nestjs-redisx/session';

const app = await Test.createTestingModule({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'x', port: 1 }, // never contacted
      global: { driver: MEMORY_DRIVER_TYPE },
      plugins: [new SessionPlugin({ maxSessionsPerUser: 2 })],
    }),
  ],
}).compile();
await app.init();

const store = app.get(SESSION_STORE);
const sessions = app.get(SESSION_SERVICE);

// Simulate two logins (passport-shaped payloads)
await store.set('sid-laptop', { cookie: {}, passport: { user: 'user-1' } });
await store.set('sid-phone', { cookie: {}, passport: { user: 'user-1' } });

expect(await sessions.countByUser('user-1')).toBe(2);
await sessions.revokeAllExcept('user-1', 'sid-phone');
expect(await store.get('sid-laptop')).toBeNull();
```

## E2E With Real Middleware

For full-stack confidence, boot the Nest testing module for DI, wire real `express-session` onto a plain express app, and drive it with `supertest` cookie jars:

```typescript
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { toExpressStore } from '@nestjs-redisx/session';

const web = express();
web.use(session({ secret: 't', resave: false, saveUninitialized: false, store: await toExpressStore(store) }));
// ...login route setting req.session.passport = { user }

const laptop = request.agent(web); // separate cookie jar per "device"
const phone = request.agent(web);
await laptop.post('/login/user-1').expect(200);
await phone.post('/login/user-1').expect(200);
await phone.post('/logout-others').expect(200);
await laptop.get('/me').expect(401); // old cookie rejected
```

The plugin's own test suite runs this exact matrix (express + fastify + passport-style login) against both the memory driver and live Redis.

## TTL and Cap Scenarios

The store reads real time (`Date.now()`), so TTL/cap tests use small real timings rather than fake timers:

```typescript
await store.set('sid', { cookie: {} }, { ttlMs: 100 });
await new Promise((r) => setTimeout(r, 150));
expect(await store.get('sid')).toBeNull();
```
