<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/circuit-breaker

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/circuit-breaker)](https://www.npmjs.com/package/@nestjs-redisx/circuit-breaker)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/circuit-breaker)](https://www.npmjs.com/package/@nestjs-redisx/circuit-breaker)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/circuit-breaker)](https://opensource.org/licenses/MIT)

Distributed circuit breaker plugin for NestJS RedisX. Implements the classic `closed` / `open` / `half-open` state machine with a rolling failure window, an open cooldown, and capped half-open probes — with state shared across all application instances via Redis (atomic Lua scripts), a proxy-based `@WithCircuitBreaker` decorator that works on any Injectable method, and per-call fallbacks.

At its core sits a pure, time-injected finite state machine (`CircuitBreakerState`): no I/O, no `Date.now()` — every time-dependent method takes an explicit `now` (epoch ms), so the policy is deterministic and hermetically testable.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/circuit-breaker ioredis
```

## Quick Example

```typescript
import { Module, Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CircuitBreakerPlugin, WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CircuitBreakerPlugin({
          failureThreshold: 5, // trip after 5 failures...
          windowMs: 10000, // ...within a 10s rolling window
          openDurationMs: 30000, // stay OPEN for 30s before probing
        }),
      ],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class PaymentsService {
  @WithCircuitBreaker({ key: 'stripe', fallback: () => ({ queued: true }) })
  async charge(dto: ChargeDto) {
    return this.stripe.charge(dto); // fails fast + falls back while OPEN
  }
}
```

## Features

- **Distributed state** — all instances share one circuit via Redis; transitions are atomic Lua scripts (Cluster-safe: state keys share a hash tag).
- **`@WithCircuitBreaker`** — proxy-based decorator for any Injectable method: key interpolation (`'user:{0}'`), per-method overrides, `fallback`, `onOpen: 'skip'`, and `skip()` bypass.
- **`CircuitBreakerService`** — programmatic `execute(key, fn, { fallback })`, manual `recordSuccess` / `recordFailure`, non-mutating `getState`, `reset`.
- **fail-open / fail-closed** — choose availability or strictness when the state store itself is unavailable.
- **Pure core** — `CircuitBreakerState` is exported for hermetic unit tests of your breaker policy (explicit `now`, no fake timers).
- **Testable without Redis** — runs on the `@nestjs-redisx/testing` in-memory driver, Lua included.

## Documentation

Full reference: [nestjs-redisx.dev/en/reference/circuit-breaker](https://nestjs-redisx.dev/en/reference/circuit-breaker/)

## License

MIT
