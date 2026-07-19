<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/circuit-breaker

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/circuit-breaker)](https://www.npmjs.com/package/@nestjs-redisx/circuit-breaker)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/circuit-breaker)](https://www.npmjs.com/package/@nestjs-redisx/circuit-breaker)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/circuit-breaker)](https://opensource.org/licenses/MIT)

Distributed circuit breaker for NestJS RedisX with the classic `closed` / `open` / `half-open` state machine.

At its core sits a **pure, time-injected finite state machine** (`CircuitBreakerState`): no I/O, no `Date.now()` — every time-dependent method takes an explicit `now` (epoch ms), which makes the breaker logic fully deterministic and hermetically testable.

## Status

Early development. This release ships the state-machine core only; the Redis-backed store, NestJS service, and `@CircuitBreaker` decorator are not published yet.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/circuit-breaker ioredis
```

## License

MIT
