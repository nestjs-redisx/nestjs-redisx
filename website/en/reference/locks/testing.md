---
title: Testing
description: Testing services that use locks
---

# Testing

How to test services that use distributed locks.

## Mock LockService

```typescript
import { Test } from '@nestjs/testing';
import { LOCK_SERVICE, type ILockService, type ILock } from '@nestjs-redisx/locks';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';

describe('OrderService', () => {
  let service: OrderService;
  let lockService: MockedObject<ILockService>;

  beforeEach(async () => {
    const mockLock: Partial<ILock> = {
      release: vi.fn(),
      extend: vi.fn(),
    };

    const mockLockService: Partial<ILockService> = {
      acquire: vi.fn().mockResolvedValue(mockLock),
      tryAcquire: vi.fn().mockResolvedValue(mockLock),
      withLock: vi.fn().mockImplementation(async (key, fn) => fn()),
    };

    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: LOCK_SERVICE,
          useValue: mockLockService,
        },
      ],
    }).compile();

    service = module.get(OrderService);
    lockService = module.get(LOCK_SERVICE);
  });

  it('should acquire lock before processing', async () => {
    await service.processOrder('123');

    expect(lockService.acquire).toHaveBeenCalledWith(
      'order:123',
      expect.any(Object),
    );
  });
});
```

## Integration Tests

```typescript
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin, LOCK_SERVICE, type ILockService } from '@nestjs-redisx/locks';
import Redis from 'ioredis';

describe('LockService (integration)', () => {
  let app: INestApplication;
  let lockService: ILockService;
  let redis: Redis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [new LocksPlugin()],
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    
    lockService = app.get(LOCK_SERVICE);
    redis = new Redis();
  });

  afterAll(async () => {
    await redis.flushall();
    await redis.quit();
    await app.close();
  });

  it('should create lock in Redis', async () => {
    const lock = await lockService.acquire('test:lock');
    
    const value = await redis.get('_lock:test:lock');
    expect(value).toBeDefined();
    
    await lock.release();
  });
});
```

## Next Steps

- [Recipes](./recipes) — Real-world examples
- [Troubleshooting](./troubleshooting) — Debug issues
