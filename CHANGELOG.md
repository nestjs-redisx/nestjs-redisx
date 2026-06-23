# Changelog

All notable changes to NestJS RedisX are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
