# NestJS RedisX — Example App

Demo application showing all `@nestjs-redisx` plugins in action.

## Architecture

Uses **plugin architecture** — all 7 plugins registered via `RedisModule.forRootAsync()` with `ConfigService`.

## Running

```bash
# Start Redis
docker-compose up -d

# Start app
cd apps/example
npm run start:dev
```

## Endpoints

See the Postman collection: `NestJS-RedisX.postman_collection.json`

### Core
- `GET /demo/core/health` — health check
- `GET /demo/core/info` — Redis server info
- `GET /demo/core/string/:key` — get string value
- `POST /demo/core/string` — set string value

### Cache
- `GET /demo/cache/test` — basic cache test
- `GET /demo/cache/user/:id` — cached user lookup
- `GET /demo/cache/products/:category` — L1+L2 cached products
- `GET /demo/cache/stats` — cache hit/miss statistics

### Locks
- `POST /demo/locks/demo` — distributed lock demo
- `GET /demo/locks/status` — lock status

### Rate Limit
- `GET /demo/rate-limit/test` — rate limiting test
- `GET /demo/rate-limit/fixed` — fixed window algorithm

### Idempotency
- `POST /demo/idempotency/order` — idempotent order creation (use `Idempotency-Key` header)

### Streams
- `POST /demo/streams/publish` — publish message to a stream
- `GET /demo/streams/stats` — stream consumer statistics

### Metrics
- `GET /metrics` — Prometheus metrics endpoint

### Integration
- `POST /integration/checkout` — combined scenario using all plugins

## Configuration

Environment variables in `.env`:

```env
REDIS_MODE=standalone
REDIS_DRIVER=ioredis
REDIS_HOST=localhost
REDIS_PORT=6379
```
