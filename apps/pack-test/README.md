## npm Pack Integration Test

Validates all @nestjs-redisx packages work when installed from npm tarballs.

### What it tests

- `@nestjs-redisx/core` -- RedisModule.forRoot(), RedisService
- `@nestjs-redisx/cache` -- @Cached decorator, CacheService.invalidate()
- `@nestjs-redisx/locks` -- @WithLock decorator, lock serialization
- `@nestjs-redisx/rate-limit` -- @RateLimit decorator + RateLimitGuard
- `@nestjs-redisx/idempotency` -- @Idempotent decorator, response replay
- `@nestjs-redisx/streams` -- StreamProducerService.publish()
- `@nestjs-redisx/metrics` -- MetricsPlugin, /metrics endpoint
- `@nestjs-redisx/tracing` -- TracingPlugin registers without errors

### Prerequisites

- Redis running on localhost:6379
- All packages built: `npm run build` from repo root

### Run

```bash
npm run pack-install   # pack + install tarballs
npm test               # run e2e tests
```
