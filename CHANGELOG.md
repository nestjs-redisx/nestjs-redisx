# Changelog

All notable changes to NestJS RedisX are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-07-20

### Added

- `@nestjs-redisx/circuit-breaker`: new package — a distributed circuit breaker (`closed` / `open` / `half-open`) backed by Redis. At its core is a pure, time-injected finite state machine (`CircuitBreakerState`) that takes an explicit `now` (no hidden `Date.now()`), so the policy is deterministic and fully unit-testable; the distributed layer replicates it 1:1 with atomic Lua scripts. Provides `CircuitBreakerPlugin`, `CIRCUIT_BREAKER_SERVICE` (`execute` with fallback, manual `recordSuccess` / `recordFailure`, `getState`, `reset`), and a proxy-based `@WithCircuitBreaker` decorator that works on any Injectable method (key interpolation, per-method overrides, `fallback`, `onOpen`, and `skip`). Half-open probes whose outcome is never recorded (e.g. a crashed process) are auto-reclaimed after `probeTimeoutMs` (default: `openDurationMs`). Honors `errorPolicy` (`fail-open` / `fail-closed`) when the state store is unavailable, and works on Redis Cluster (state keys share a hash tag). Also runs on the `@nestjs-redisx/testing` in-memory driver.
- `core`: added `CIRCUIT_BREAKER_OPEN`, `CIRCUIT_BREAKER_STORE_ERROR`, and `CIRCUIT_BREAKER_CONFIG_INVALID` to `ErrorCode`.

### Fixed

- `cache`: stampede protection served **stale (pre-invalidation) values for up to 100 ms** after any load. A completed singleflight stayed in the in-process flight map (`setTimeout(delete, 100)`), so the pattern "mutation → `invalidateTags`/`delete` → immediate `getOrSet`" (SSE / TanStack Query refetch) coalesced onto the already-resolved flight: the loader was not called, the old value was returned with `stampedePrevented` incremented, and the cache was not re-populated. The same lingering window could also hang a caller for the full `waitTimeout` if it attached to a flight whose loader had failed with no waiters. Flights are now removed **synchronously** on completion — in-flight waiters are unaffected (they already hold the promise), and sequential calls always re-check the cache and reload.

## [1.5.1] - 2026-07-19

### Fixed

- `cache`: L1 (in-memory) entries expired ~60 ms after being written. `CacheService` passes the L1 TTL in **seconds** (per the public `l1.ttl` config), but `L1MemoryStoreAdapter` treated the value as **milliseconds** when computing `expiresAt`, so a `@Cached` value effectively lived a few milliseconds and almost every read was an L1 miss (falling through to L2). The L1 store now consistently interprets TTL in seconds, matching the config, the L2 store, and the docs. Fixes [#10](https://github.com/nestjs-redisx/nestjs-redisx/issues/10).

## [1.5.0] - 2026-06-28

### Added

- `@nestjs-redisx/testing`: new package — an in-memory Redis driver for unit-testing without a running Redis. It runs the real `cache`, `locks`, `rate-limit`, `idempotency`, and `streams` plugins — including their Lua scripts and stream consumer groups (PEL, `XACK` / `XCLAIM` / `XPENDING`) — entirely in memory. Exposes `RedisTestingModule` (a `RedisModule` wrapper that forces the `'memory'` driver), `registerMemoryDriver()`, and `MemoryRedisAdapter`. Install it as a devDependency.
- `core`: a driver registry (`registerDriver()`) lets first-party packages plug in an alternative `IRedisDriver` implementation (used by `@nestjs-redisx/testing`) without modifying core. Built-in `ioredis` / `node-redis` types cannot be overridden; `DriverType` is widened to accept registered custom type strings.

## [1.4.0] - 2026-06-23

### Added

- `cache`: `stampede.fallback` (`'load'` | `'error'` | `'null'`, default `'load'`) is now honored when stampede protection times out — previously the option was inert and the service always threw `StampedeError`.
- `idempotency`: `errorPolicy` (`'fail-open'` | `'fail-closed'`) is now honored when the store is unavailable. A built-in exception filter now maps idempotency errors to meaningful HTTP status codes (fingerprint mismatch → 422, previous-failed/timeout → 409, missing key → 400) instead of 500.
- `locks`: `waitTimeout` now bounds the total time `acquire()` waits for a contended lock.
- `rate-limit`: token-bucket `peek()` / `getState()` now report the real bucket state (read via `HMGET` with refill) instead of placeholder values.
- `streams`: the `trim` config is now honored on publish, including keep-all (`trim.enabled: false`) for event sourcing; `consumer.claimIdleTimeout` now drives a background auto-claim of messages left pending by crashed/idle consumers; `producer.autoCreate: false` now sets `NOMKSTREAM`.
- `core`: synchronous `RedisModule.forRoot({ plugins: [...] })` now provides `REDIS_CLIENTS_INITIALIZATION`, so plugins resolve their Redis driver under sync `forRoot` (previously only `forRootAsync` worked).
- NestJS 11 build support across the monorepo; CI matrix extended to Node 22 and 24.
- `llms-full.txt`: a complete public-API method reference, with a CI check that fails if any exported service method is undocumented.

### Fixed

- `rate-limit`: the limit is consumed at most once per request even when the guard is bound more than once (`@RateLimit` on both class and method, or `@RateLimit` combined with a global `APP_GUARD`).
- `idempotency`: failed records now receive an explicit TTL instead of relying on the leftover lock expiry.
- `locks`: auto-renewal failures are now logged (and surfaced via `isAutoRenewing`) instead of being swallowed by an empty `catch`.
- `cache`: `TagInvalidationError` is preserved instead of being rewrapped as a generic `CacheError`, so it can be caught by type.
- Documentation aligned with actual library behavior (cache key charset, read/write fail policies, decorator key templates, and more).

## [1.2.0] - 2026-04-19

### Added
- Official Fastify adapter support in the `rate-limit` and `idempotency` plugins. Both adapters run through the same HTTP handling path and are covered by end-to-end tests.
- `apps/example`: Fastify bootstrap entry (`main.fastify.ts`), `start:fastify` script, and parallel `express.e2e-spec.ts` / `fastify.e2e-spec.ts` suites covering rate-limit headers and idempotent replay.
- `streams`: Consumer shutdown is now bounded by `shutdownTimeoutMs` (default `10000`). Handlers that exceed this window keep running in the background until their own logic completes or the Redis connection closes; the owning message remains in the stream's pending entries list and is redelivered to another consumer on restart. To match the previous unbounded behaviour, set `shutdownTimeoutMs: Infinity`.

### Fixed
- `idempotency`: request fingerprint on Fastify. The interceptor previously relied on Express-only `request.path`, which is `undefined` under Fastify and caused distinct requests to hash to the same fingerprint.
- `streams`: StreamsPlugin now shuts down gracefully on `app.close()` / `SIGTERM` via `OnApplicationShutdown`. Previously the consumer's blocking `XREADGROUP` call could keep the Node.js event loop alive after the application closed. Applications using `enableShutdownHooks()` (Kubernetes, systemd, Docker) no longer need `--forceExit` or `SIGKILL` to terminate.
- `tracing`: Bound the OpenTelemetry provider shutdown with a short timeout and swallow export failures. A dead / unreachable OTLP collector can no longer block or fail `app.close()`.

### Changed
- `rate-limit`: the guard and the 429 exception filter now write response headers and bodies through `HttpAdapterHost` from `@nestjs/core` instead of duck-typing the Express `response`. Behaviour on Express is byte-for-byte unchanged.
- `idempotency`: the interceptor now sets status / headers via `HttpAdapterHost` and derives the request path via `httpAdapter.getRequestUrl()`. Replay behaviour on Express is unchanged.

### Removed
- `metrics`: unused `@types/express` from `devDependencies`. The package never imported from Express.

### Compatibility
- No breaking changes. Public exports (`RateLimitGuard`, `RateLimitExceptionFilter`, `IdempotencyInterceptor`, `@RateLimit`, `@Idempotent`, `@IdempotencyKey`, `StreamsPlugin`, `@StreamConsumer`, injection tokens, error classes, plugin options) are identical to `1.1.2`. The new `shutdownTimeoutMs` streams option is optional with a safe default.
