---
title: Testing
description: Testing rate-limited endpoints and services
---

# Testing

Test services that use rate limiting.

## Mock RateLimitService

```typescript
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { RATE_LIMIT_SERVICE, type IRateLimitService } from '@nestjs-redisx/rate-limit';

describe('ApiController', () => {
  let controller: ApiController;
  let rateLimitService: MockedObject<IRateLimitService>;

  beforeEach(async () => {
    const mockRateLimitService: Partial<IRateLimitService> = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 99,
        limit: 100,
        reset: Date.now() / 1000 + 60,
        current: 1,
      }),
      peek: vi.fn(),
      reset: vi.fn(),
      getState: vi.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        {
          provide: RATE_LIMIT_SERVICE,
          useValue: mockRateLimitService,
        },
      ],
    }).compile();

    controller = module.get(ApiController);
    rateLimitService = module.get(RATE_LIMIT_SERVICE);
  });

  it('should allow request under limit', async () => {
    rateLimitService.check.mockResolvedValue({
      allowed: true,
      remaining: 50,
      limit: 100,
      reset: Date.now() / 1000 + 60,
      current: 50,
    });

    const result = await controller.getData();

    expect(result).toBeDefined();
    expect(rateLimitService.check).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ points: 100 }),
    );
  });

  it('should reject when limit exceeded', async () => {
    rateLimitService.check.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 100,
      reset: Date.now() / 1000 + 60,
      retryAfter: 45,
      current: 100,
    });

    await expect(controller.getData()).rejects.toThrow();
  });
});
```

## Integration Tests

```typescript
describe('RateLimit (integration)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [
            new RateLimitPlugin({
              defaultPoints: 10,
              defaultDuration: 60,
            }),
          ],
        }),
        ApiModule,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    redis = new Redis({ host: 'localhost', port: 6379 });
  });

  afterAll(async () => {
    await redis.flushall();
    await redis.quit();
    await app.close();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  it('should enforce rate limit', async () => {
    // Make 10 successful requests
    for (let i = 0; i < 10; i++) {
      const response = await request(app.getHttpServer())
        .get('/api/data')
        .expect(200);

      expect(response.headers['x-ratelimit-remaining']).toBe(String(9 - i));
    }

    // 11th request should be rejected
    await request(app.getHttpServer())
      .get('/api/data')
      .expect(429);
  });

  it('should reset after duration', async () => {
    // Hit limit
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/api/data');
    }

    await request(app.getHttpServer())
      .get('/api/data')
      .expect(429);

    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 61000));

    // Should be allowed again
    await request(app.getHttpServer())
      .get('/api/data')
      .expect(200);
  });

  it('should track different keys separately', async () => {
    // User 1: use 5 requests
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .get('/api/data')
        .set('X-User-ID', 'user1')
        .expect(200);
    }

    // User 2: should have full limit
    const response = await request(app.getHttpServer())
      .get('/api/data')
      .set('X-User-ID', 'user2')
      .expect(200);

    expect(response.headers['x-ratelimit-remaining']).toBe('9');
  });
});
```

## Reset Limits in Tests

```typescript
import { RATE_LIMIT_SERVICE } from '@nestjs-redisx/rate-limit';

describe('ApiService', () => {
  let service: ApiService;
  let rateLimitService: IRateLimitService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [new RateLimitPlugin()],
        }),
      ],
      providers: [ApiService],
    }).compile();

    service = module.get(ApiService);
    rateLimitService = module.get(RATE_LIMIT_SERVICE);
  });

  afterEach(async () => {
    // Reset all rate limits after each test
    await rateLimitService.reset('*');
  });

  it('should process request', async () => {
    const result = await service.processRequest('user123');
    expect(result).toBeDefined();
  });
});
```

## Test Decorators

```typescript
describe('@RateLimit decorator', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Controller('test')
    class TestController {
      @Get('limited')
      @RateLimit({ points: 5, duration: 60 })
      limited() {
        return { success: true };
      }

      @Get('unlimited')
      unlimited() {
        return { success: true };
      }
    }

    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [new RateLimitPlugin()],
        }),
      ],
      controllers: [TestController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('should apply rate limit to decorated endpoint', async () => {
    // First 5 requests succeed
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .get('/test/limited')
        .expect(200);
    }

    // 6th request fails
    await request(app.getHttpServer())
      .get('/test/limited')
      .expect(429);
  });

  it('should not rate limit non-decorated endpoint', async () => {
    // Make many requests - all should succeed
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .get('/test/unlimited')
        .expect(200);
    }
  });
});
```

## Test Headers

```typescript
it('should include rate limit headers', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/data')
    .expect(200);

  expect(response.headers).toHaveProperty('x-ratelimit-limit');
  expect(response.headers).toHaveProperty('x-ratelimit-remaining');
  expect(response.headers).toHaveProperty('x-ratelimit-reset');

  expect(parseInt(response.headers['x-ratelimit-limit'])).toBeGreaterThan(0);
  expect(parseInt(response.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
});

it('should include Retry-After on 429', async () => {
  // Hit limit
  for (let i = 0; i < 10; i++) {
    await request(app.getHttpServer()).get('/api/data');
  }

  const response = await request(app.getHttpServer())
    .get('/api/data')
    .expect(429);

  expect(response.headers).toHaveProperty('retry-after');
  expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
});
```

## Test Different Algorithms

```typescript
describe('Rate limit algorithms', () => {
  describe('Fixed Window', () => {
    it('should allow burst at window boundary', async () => {
      // Test fixed window behavior
    });
  });

  describe('Sliding Window', () => {
    it('should prevent burst at any time', async () => {
      // Test sliding window behavior
    });
  });

  describe('Token Bucket', () => {
    it('should allow controlled burst', async () => {
      // Test token bucket behavior
    });
  });
});
```

## Test Skip Conditions

```typescript
it('should skip rate limit for admins', async () => {
  @Controller('test')
  class TestController {
    @Get('data')
    @RateLimit({
      points: 5,
      skip: (ctx) => {
        const req = ctx.switchToHttp().getRequest();
        return req.user?.role === 'admin';
      },
    })
    getData(@Req() req: any) {
      return { success: true };
    }
  }

  // Admin user - no limit
  for (let i = 0; i < 20; i++) {
    await request(app.getHttpServer())
      .get('/test/data')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
  }

  // Regular user - should hit limit
  for (let i = 0; i < 5; i++) {
    await request(app.getHttpServer())
      .get('/test/data')
      .set('Authorization', 'Bearer user-token')
      .expect(200);
  }

  await request(app.getHttpServer())
    .get('/test/data')
    .set('Authorization', 'Bearer user-token')
    .expect(429);
});
```

## Performance Testing

```typescript
describe('Rate limit performance', () => {
  it('should handle high request volume', async () => {
    const start = Date.now();
    const requests = 1000;

    await Promise.all(
      Array.from({ length: requests }, () =>
        request(app.getHttpServer()).get('/api/data')
      )
    );

    const duration = Date.now() - start;
    const rps = requests / (duration / 1000);

    expect(rps).toBeGreaterThan(100);  // Should handle >100 req/s
  });
});
```

## Next Steps

- [Recipes](./recipes) — Real-world examples
- [Troubleshooting](./troubleshooting) — Debug issues
