---
title: Configuration
description: Complete configuration reference for Rate Limit Plugin
---

# Configuration

Full reference for all Rate Limit Plugin options.

## Basic Configuration

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new RateLimitPlugin({
          // Your options here
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

## Complete Options Reference

```typescript
new RateLimitPlugin({
  // Algorithm Settings
  defaultAlgorithm: 'sliding-window', // 'fixed-window' | 'sliding-window' | 'token-bucket'
  defaultPoints: 100,
  defaultDuration: 60,

  // Key Settings
  keyPrefix: 'rl:',
  defaultKeyExtractor: 'ip', // 'ip' | 'user' | 'apiKey' | function

  // Response Headers
  includeHeaders: true,
  headers: {
    limit: 'X-RateLimit-Limit',
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    retryAfter: 'Retry-After',
  },

  // Error Handling
  errorPolicy: 'fail-closed', // 'fail-closed' | 'fail-open'

  skip: (context) => {
    const req = context.switchToHttp().getRequest();
    return req.user?.role === 'admin';
  },

  errorFactory: (result) => {
    return new HttpException(
      `Rate limit exceeded. Retry in ${result.retryAfter}s`,
      HttpStatus.TOO_MANY_REQUESTS
    );
  },
})
```

## Configuration by Use Case

### Public API

```typescript
new RateLimitPlugin({
  defaultAlgorithm: 'sliding-window',
  defaultPoints: 100,
  defaultDuration: 60,
  defaultKeyExtractor: 'ip',
  includeHeaders: true,
  errorPolicy: 'fail-closed',
})
```

### Internal Service

```typescript
new RateLimitPlugin({
  defaultAlgorithm: 'token-bucket',
  defaultPoints: 1000,
  defaultDuration: 1,  // Per second
  defaultKeyExtractor: 'apiKey',
  errorPolicy: 'fail-open',  // Availability over security
})
```

### Premium API

```typescript
new RateLimitPlugin({
  defaultAlgorithm: 'sliding-window',
  defaultPoints: 10,  // Low default
  defaultDuration: 60,
  defaultKeyExtractor: 'user',
  skip: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.plan === 'enterprise';
  },
})
```

## Async Configuration

Use `forRootAsync` with `ConfigService` for environment-based configuration:

<<< @/apps/demo/src/plugins/rate-limit/env-config.setup.ts{typescript}

## Environment Configuration

```typescript
// config/rate-limit.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('rateLimit', () => ({
  algorithm: process.env.RATE_LIMIT_ALGORITHM || 'sliding-window',
  points: parseInt(process.env.RATE_LIMIT_POINTS || '100', 10),
  duration: parseInt(process.env.RATE_LIMIT_DURATION || '60', 10),
  errorPolicy: process.env.RATE_LIMIT_FAIL_OPEN === 'true' ? 'fail-open' : 'fail-closed',
}));
```

```bash
# .env
RATE_LIMIT_ALGORITHM=sliding-window
RATE_LIMIT_POINTS=100
RATE_LIMIT_DURATION=60
RATE_LIMIT_FAIL_OPEN=false
```

## Options Deep Dive

### Algorithm Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultAlgorithm` | string | `sliding-window` | Default algorithm |
| `defaultPoints` | number | `100` | Requests per window |
| `defaultDuration` | number | `60` | Window in seconds |

### Key Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyPrefix` | string | `rl:` | Redis key prefix |
| `defaultKeyExtractor` | string/function | `ip` | How to identify client |

### Header Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeHeaders` | boolean | `true` | Add rate limit headers |
| `headers.limit` | string | `X-RateLimit-Limit` | Max requests header |
| `headers.remaining` | string | `X-RateLimit-Remaining` | Remaining header |
| `headers.reset` | string | `X-RateLimit-Reset` | Reset timestamp header |
| `headers.retryAfter` | string | `Retry-After` | Retry delay header |

### Error Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `errorPolicy` | string | `fail-closed` | Behavior on Redis error |
| `skip` | function | undefined | Skip rate limiting if true |
| `errorFactory` | function | undefined | Custom error creator |

## Next Steps

- [Decorator](./decorator) — Learn @RateLimit decorator
- [Algorithms](./algorithms) — Deep dive into algorithms
