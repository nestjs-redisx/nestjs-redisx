---
title: Service API
description: Programmatic rate limiting with RateLimitService
---

# Service API

Use RateLimitService for programmatic control.

## Service Injection

<<< @/apps/demo/src/plugins/rate-limit/service-basic.usage.ts{typescript}

## check() Method

Check if request is allowed:

```typescript
async checkRateLimit(userId: string): Promise<boolean> {
  const result = await this.rateLimitService.check(`user:${userId}`, {
    points: 100,
    duration: 60,
    algorithm: 'sliding-window',
  });

  return result.allowed;
}
```

### RateLimitResult

```typescript
interface IRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  current: number;
}
```

## getState() Method

Get human-readable state for monitoring:

```typescript
async getStatus(userId: string): Promise<{ current: number; limit: number; resetAt: Date }> {
  const state = await this.rateLimitService.getState(`user:${userId}`, {
    points: 100,
    duration: 60,
  });

  return {
    current: state.current,
    limit: state.limit,
    resetAt: state.resetAt,
  };
}
```

## reset() Method

Reset rate limit counter:

```typescript
async resetUserLimit(userId: string): Promise<void> {
  await this.rateLimitService.reset(`user:${userId}`);
}

// Use case: Premium user upgrade
async upgradeToPremium(userId: string): Promise<void> {
  await this.userService.upgrade(userId);
  await this.rateLimitService.reset(`user:${userId}`);
}
```

## peek() Method

Check status without consuming:

```typescript
async getRateLimitStatus(userId: string): Promise<RateLimitStatus> {
  const result = await this.rateLimitService.peek(`user:${userId}`, {
    points: 100,
    duration: 60,
  });

  return {
    remaining: result.remaining,
    limit: result.limit,
    resetAt: new Date(result.reset * 1000),
  };
}
```

## Conditional Rate Limiting

```typescript
async apiCall(userId: string, isPremium: boolean): Promise<Response> {
  const config = isPremium
    ? { points: 1000, duration: 60 }
    : { points: 100, duration: 60 };

  const result = await this.rateLimitService.check(`user:${userId}`, config);

  if (!result.allowed) {
    throw new TooManyRequestsException();
  }

  return this.makeApiCall();
}
```

## Multi-Resource Locking

Check multiple limits:

```typescript
async complexOperation(userId: string, orgId: string): Promise<void> {
  // Check user limit
  const userLimit = await this.rateLimitService.check(`user:${userId}`, {
    points: 10,
    duration: 60,
  });

  if (!userLimit.allowed) {
    throw new TooManyRequestsException('User limit exceeded');
  }

  // Check org limit
  const orgLimit = await this.rateLimitService.check(`org:${orgId}`, {
    points: 100,
    duration: 60,
  });

  if (!orgLimit.allowed) {
    throw new TooManyRequestsException('Organization limit exceeded');
  }

  // Both limits OK, proceed
  await this.doComplexOperation();
}
```

## Graceful Degradation

```typescript
async getData(userId: string): Promise<Response> {
  const result = await this.rateLimitService.check(`cache:${userId}`, {
    points: 10,
    duration: 60,
  });

  if (result.allowed) {
    // Serve from cache (fast)
    return this.getCachedData(userId);
  } else {
    // Fallback to database (slow but available)
    return this.getDataFromDB(userId);
  }
}
```

## Dynamic Limits

Adjust limits based on runtime conditions:

```typescript
async dynamicRateLimit(userId: string): Promise<void> {
  const user = await this.userService.findOne(userId);

  const limits = {
    free: { points: 10, duration: 60 },
    pro: { points: 100, duration: 60 },
    enterprise: { points: 1000, duration: 60 },
  };

  const config = limits[user.tier] || limits.free;

  const result = await this.rateLimitService.check(`user:${userId}`, config);

  if (!result.allowed) {
    throw new TooManyRequestsException();
  }
}
```

## Background Jobs

Rate limit background jobs:

<<< @/apps/demo/src/plugins/rate-limit/service-email.usage.ts{typescript}

## Webhook Rate Limiting

<<< @/apps/demo/src/plugins/rate-limit/recipes/webhook.usage.ts{typescript}

## Testing Support

Mock service for unit tests:

```typescript
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { RATE_LIMIT_SERVICE, type IRateLimitService } from '@nestjs-redisx/rate-limit';

describe('ApiService', () => {
  let service: ApiService;
  let rateLimitService: MockedObject<IRateLimitService>;

  beforeEach(async () => {
    const mockRateLimitService = {
      check: vi.fn(),
      peek: vi.fn(),
      reset: vi.fn(),
      getState: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ApiService,
        {
          provide: RATE_LIMIT_SERVICE,
          useValue: mockRateLimitService,
        },
      ],
    }).compile();

    service = module.get(ApiService);
    rateLimitService = module.get(RATE_LIMIT_SERVICE);
  });

  it('should check rate limit', async () => {
    rateLimitService.check.mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      reset: Date.now() / 1000 + 60,
      current: 1,
    });

    const result = await service.checkRateLimit('user123');

    expect(result).toBe(true);
    expect(rateLimitService.check).toHaveBeenCalledWith('user:user123', {
      points: 100,
      duration: 60,
      algorithm: 'sliding-window',
    });
  });
});
```

## Next Steps

- [Algorithms](./algorithms) — Deep dive into algorithms
- [Testing](./testing) — Test rate-limited code
