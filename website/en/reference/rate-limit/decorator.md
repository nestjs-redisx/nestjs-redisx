---
title: "@RateLimit Decorator"
description: Declarative rate limiting with method and class decorators
---

# @RateLimit Decorator

Apply rate limits declaratively.

## Basic Usage

```typescript
import { Controller, Get } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';

@Controller('api')
export class ApiController {
  @Get('data')
  @RateLimit({ points: 10, duration: 60 })
  getData() {
    return { data: 'value' };
  }
}
```

## Options Reference

```typescript
interface IRateLimitOptions {
  key?: string | KeyExtractor;
  algorithm?: 'fixed-window' | 'sliding-window' | 'token-bucket';
  points?: number;
  duration?: number;
  refillRate?: number;
  skip?: (context: ExecutionContext) => boolean | Promise<boolean>;
  message?: string;
  errorFactory?: (result: RateLimitResult) => Error;
}
```

## Method Decorator

```typescript
@Controller('api')
export class ApiController {
  // 10 requests per minute per IP
  @Get('public')
  @RateLimit({ points: 10, duration: 60 })
  getPublic() {
    return { public: true };
  }

  // 100 requests per minute per user
  @Get('private')
  @RateLimit({ points: 100, duration: 60, key: 'user' })
  getPrivate() {
    return { private: true };
  }

  // Token bucket: 50 capacity, 5 tokens/sec refill
  @Get('stream')
  @RateLimit({
    algorithm: 'token-bucket',
    points: 50,
    refillRate: 5,
  })
  getStream() {
    return { stream: true };
  }
}
```

## Class Decorator

Apply to all methods in controller:

```typescript
@Controller('api')
@RateLimit({ points: 100, duration: 60 })
export class ApiController {
  @Get('endpoint1')  // Inherits 100/min
  endpoint1() {}

  @Get('endpoint2')  // Inherits 100/min
  endpoint2() {}

  @Get('special')
  @RateLimit({ points: 10, duration: 60 })  // Override: 10/min
  special() {}
}
```

## Key Patterns

### Built-in Keys

```typescript
// IP address (default)
@RateLimit({ points: 100 })
// Redis key: rl:{algorithm}:192.168.1.1

// User ID (from request.user.id)
@RateLimit({ points: 100, key: 'user' })
// Redis key: rl:{algorithm}:user:123

// API key (from X-API-Key or Authorization header)
@RateLimit({ points: 100, key: 'apiKey' })
// Redis key: rl:{algorithm}:apikey:sk_live_xxx

// Static key (global limit)
@RateLimit({ points: 10000, key: 'global' })
// Redis key: rl:{algorithm}:global
```

### Custom Key Function

```typescript
// By tenant
@RateLimit({
  key: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return `tenant:${req.headers['x-tenant-id']}`;
  },
  points: 1000,
})

// By route + user
@RateLimit({
  key: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return `${req.path}:${req.user?.id || req.ip}`;
  },
  points: 50,
})
```

## Skip Conditions

```typescript
// Skip for admins
@RateLimit({
  points: 10,
  skip: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.role === 'admin';
  },
})

// Skip for premium
@RateLimit({
  points: 10,
  skip: async (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    const user = await this.userService.getUser(req.user.id);
    return user.plan === 'premium';
  },
})

// Skip for internal IPs
@RateLimit({
  points: 100,
  skip: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.ip.startsWith('10.') || req.ip.startsWith('192.168.');
  },
})
```

## Custom Errors

### Custom Message

```typescript
@RateLimit({
  points: 10,
  message: 'Too many requests. Try again in a minute.',
})
```

### Custom Error Factory

```typescript
@RateLimit({
  points: 10,
  errorFactory: (result) => {
    return new HttpException({
      statusCode: 429,
      message: 'Rate limit exceeded',
      retryAfter: result.retryAfter,
      limit: result.limit,
      remaining: result.remaining,
    }, 429);
  },
})
```

## Algorithm Selection

```typescript
// Fixed Window: simple, low memory
@RateLimit({
  algorithm: 'fixed-window',
  points: 100,
  duration: 60,
})

// Sliding Window: accurate (default)
@RateLimit({
  algorithm: 'sliding-window',
  points: 100,
  duration: 60,
})

// Token Bucket: smooth with burst
@RateLimit({
  algorithm: 'token-bucket',
  points: 100,       // Bucket capacity
  refillRate: 10,    // 10 tokens/second
})
```

## Combining Limits

### Multiple Decorators

```typescript
@Get('endpoint')
@RateLimit({ points: 100, duration: 60, key: 'user' })   // 100/min per user
@RateLimit({ points: 10, duration: 1, key: 'user' })     // 10/sec per user
endpoint() {}
```

### Global + Per-User

```typescript
@Controller('api')
@RateLimit({ points: 10000, duration: 60, key: 'global' })  // Global: 10K/min
export class ApiController {
  @Get('data')
  @RateLimit({ points: 100, duration: 60, key: 'user' })    // + Per user: 100/min
  getData() {}
}
```

## Real-World Examples

### Login Endpoint

```typescript
@Post('login')
@RateLimit({
  points: 5,
  duration: 900,  // 15 minutes
  message: 'Too many login attempts. Try again in 15 minutes.',
})
async login(@Body() dto: LoginDto) {
  return this.authService.login(dto);
}
```

### File Upload

```typescript
@Post('upload')
@RateLimit({
  algorithm: 'token-bucket',
  points: 10,        // 10 concurrent
  refillRate: 0.5,   // 1 every 2 seconds
})
@UseInterceptors(FileInterceptor('file'))
async upload(@UploadedFile() file: Express.Multer.File) {
  return this.fileService.save(file);
}
```

### Expensive Operation

```typescript
@Post('report')
@RateLimit({
  points: 3,
  duration: 3600,   // 3 per hour
  key: 'user',
  message: 'Report generation limited to 3 per hour',
})
async generateReport(@Body() dto: ReportDto) {
  return this.reportService.generate(dto);
}
```

## Next Steps

- [Guard](./guard) — RateLimitGuard usage
- [Service API](./service-api) — Programmatic access
