# Changelog

All notable changes to NestJS RedisX are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-19

### Added
- Official Fastify adapter support in the `rate-limit` and `idempotency` plugins. Both adapters run through the same HTTP handling path and are covered by end-to-end tests.
- `apps/example`: Fastify bootstrap entry (`main.fastify.ts`), `start:fastify` script, and parallel `express.e2e-spec.ts` / `fastify.e2e-spec.ts` suites covering rate-limit headers and idempotent replay.
- `streams`: new `IStreamsPluginOptions.shutdownTimeoutMs` (default `10000`). Bounds how long the consumer service waits for in-flight handlers and poll loops to drain during application shutdown before returning and letting the process exit.

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
