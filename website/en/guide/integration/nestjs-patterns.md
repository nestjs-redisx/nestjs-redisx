---
title: NestJS Patterns
description: Using RedisX with Guards, Interceptors, and Filters
---

# NestJS Patterns

Integrate NestJS RedisX with standard NestJS patterns like Guards, Interceptors, and Filters.

## Guards

### Rate Limit Guard

```typescript
// guards/rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  window: number;
  keyStrategy?: 'ip' | 'user' | 'custom';
  keyGenerator?: (context: ExecutionContext) => string;
}

export const RateLimited = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(RATE_LIMIT_SERVICE) private rateLimit: IRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const key = this.getKey(context, options);

    const result = await this.rateLimit.check(
      key,
      { points: options.limit, duration: options.window },
    );

    if (!result.allowed) {
      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', result.retryAfter);
      throw new TooManyRequestsException();
    }

    return true;
  }

  private getKey(context: ExecutionContext, options: RateLimitOptions): string {
    const request = context.switchToHttp().getRequest();

    if (options.keyGenerator) {
      return options.keyGenerator(context);
    }

    switch (options.keyStrategy) {
      case 'user':
        return `user:${request.user?.id}`;
      case 'custom':
        throw new Error('Custom strategy requires keyGenerator');
      default:
        return `ip:${request.ip}`;
    }
  }
}
```

### Cache Guard (Check Before Execution)

```typescript
// guards/cache.guard.ts
import { Injectable, CanActivate, ExecutionContext, Inject } from '@nestjs/common';
import { CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

@Injectable()
export class CacheGuard implements CanActivate {
  constructor(@Inject(CACHE_SERVICE) private cache: ICacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = this.getCacheKey(request);

    const cached = await this.cache.get(key);
    if (cached) {
      // Attach to request for controller to use
      request.cachedResponse = cached;
    }

    return true;
  }
}
```

### Lock Guard

```typescript
// guards/lock.guard.ts
import { Injectable, CanActivate, ExecutionContext, Inject, ConflictException } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';

@Injectable()
export class LockGuard implements CanActivate {
  constructor(@Inject(LOCK_SERVICE) private lockService: ILockService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const resourceId = request.params.id;

    const lock = await this.lockService.acquire(`resource:${resourceId}`, {
      ttl: 30000,
      waitTimeout: 5000,
    });

    if (!lock) {
      throw new ConflictException('Resource is being modified');
    }

    // Store lock for release in interceptor
    request.lock = lock;
    return true;
  }
}
```

## Interceptors

### Cache Interceptor

```typescript
// interceptors/cache.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Inject } from '@nestjs/common';
import { CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(@Inject(CACHE_SERVICE) private cache: ICacheService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const key = this.generateKey(request);

    // Check cache
    const cached = await this.cache.get(key);
    if (cached) {
      return of(cached);
    }

    // Execute and cache
    return next.handle().pipe(
      tap(async (response) => {
        await this.cache.set(key, response, { ttl: 300 });
      }),
    );
  }

  private generateKey(request: any): string {
    return `${request.method}:${request.url}`;
  }
}
```

### Lock Release Interceptor

```typescript
// interceptors/lock-release.interceptor.ts
@Injectable()
export class LockReleaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      finalize(async () => {
        if (request.lock) {
          await request.lock.release();
        }
      }),
    );
  }
}
```

### Timing Interceptor with Metrics

```typescript
// interceptors/timing.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  constructor(@Inject(METRICS_SERVICE) private metrics: IMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        this.metrics.observeHistogram('http_request_duration_ms', duration, {
          method: request.method,
          route: request.route?.path,
        });
      }),
    );
  }
}
```

## Exception Filters

### Rate Limit Exception Filter

```typescript
// filters/rate-limit.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { TooManyRequestsException } from '@nestjs/common';
import { Response } from 'express';

@Catch(TooManyRequestsException)
export class RateLimitFilter implements ExceptionFilter {
  catch(exception: TooManyRequestsException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      message: 'Too many requests',
      retryAfter: response.getHeader('Retry-After'),
    });
  }
}
```

### Lock Exception Filter

```typescript
// filters/lock.filter.ts
@Catch(LockTimeoutException)
export class LockExceptionFilter implements ExceptionFilter {
  catch(exception: LockTimeoutException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(409).json({
      statusCode: 409,
      message: 'Resource is currently locked',
      resource: exception.resource,
      retryAfter: 5,
    });
  }
}
```

## Pipes

### Cache Key Validation Pipe

```typescript
// pipes/cache-key.pipe.ts
@Injectable()
export class CacheKeyPipe implements PipeTransform {
  transform(value: string): string {
    // Sanitize cache key to prevent injection
    if (!/^[a-zA-Z0-9:_-]+$/.test(value)) {
      throw new BadRequestException('Invalid cache key format');
    }
    return value;
  }
}
```

## Custom Decorators

### Combined Auth + Rate Limit

```typescript
// decorators/protected.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { RateLimitGuard, RateLimited } from '../guards/rate-limit.guard';

export function Protected(rateLimit?: { limit: number; window: number }) {
  const decorators = [UseGuards(AuthGuard)];

  if (rateLimit) {
    decorators.push(
      RateLimited({ ...rateLimit, keyStrategy: 'user' }),
      UseGuards(RateLimitGuard),
    );
  }

  return applyDecorators(...decorators);
}

// Usage
@Get('profile')
@Protected({ limit: 100, window: 60 })
getProfile() { }
```

### Idempotent Operation

```typescript
// decorators/idempotent-operation.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';

export function IdempotentOperation(options?: { ttl?: number }) {
  return applyDecorators(
    Idempotent({ ttl: options?.ttl || 86400 }),
    UseGuards(AuthGuard),
  );
}

// Usage
@Post('payments')
@IdempotentOperation()
createPayment() { }
```

## Module Pattern

### Feature Module with RedisX

```typescript
// users/users.module.ts
@Module({
  imports: [
    // RedisX is globally available after forRoot
  ],
  providers: [
    UserService,
    UserCacheService,
    {
      provide: 'USER_CACHE_OPTIONS',
      useValue: {
        ttl: 3600,
        tags: ['users'],
      },
    },
  ],
  controllers: [UserController],
})
export class UsersModule {}
```

## Complete Example

```typescript
@Controller('orders')
@UseGuards(AuthGuard, RateLimitGuard)
@UseInterceptors(LockReleaseInterceptor)
@UseFilters(RateLimitFilter, LockExceptionFilter)
export class OrdersController {
  @Post()
  @RateLimited({ limit: 10, window: 60, keyStrategy: 'user' })
  @Idempotent()
  @UseGuards(LockGuard)
  async createOrder(@Body() dto: CreateOrderDto) {
    return this.orderService.create(dto);
  }

  @Get(':id')
  @Cached({ key: 'order:{0}', ttl: 300 })
  async getOrder(@Param('id') id: string) {
    return this.orderService.findById(id);
  }
}
```

## Next Steps

- [Testing Strategy](./testing-strategy) — Test these patterns
- [Guards Reference](https://docs.nestjs.com/guards) — NestJS Guards documentation
