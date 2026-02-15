---
title: Migration from ioredis
description: Migrate from raw ioredis to NestJS RedisX patterns
---

# Migration from ioredis

Migrate from direct ioredis usage to NestJS RedisX patterns while keeping access to ioredis when needed.

## What Changes

| Before (ioredis) | After (RedisX) |
|------------------|----------------|
| Manual caching logic | Declarative `@Cached` |
| Manual lock implementation | `@WithLock` decorator |
| Manual rate limiting | `@RateLimit` decorator |
| No built-in metrics | Automatic Prometheus metrics |

## What Stays the Same

- ioredis is still used under the hood
- You can access raw ioredis client when needed
- Connection options are compatible

## Migration Steps

### Step 1: Install Dependencies

::: code-group

```bash [Keep ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks
# ioredis already installed, used by default
```

```bash [Switch to node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks redis
npm uninstall ioredis
# Add global.driver: 'node-redis' to config
```

:::

### Step 2: Update Connection Setup

**Before:**

```typescript
// redis.module.ts
import Redis from 'ioredis';

@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT),
          password: process.env.REDIS_PASSWORD,
        });
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
```

**After:**

```typescript
// app.module.ts
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
      },
      plugins: [
        new CachePlugin(),
        new LocksPlugin(),
      ],
    }),
  ],
})
export class AppModule {}
```

### Step 3: Migrate Caching Logic

**Before:**

```typescript
@Injectable()
export class UserService {
  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  async getUser(id: string): Promise<User> {
    const cacheKey = `user:${id}`;
    
    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch from DB
    const user = await this.userRepository.findById(id);

    // Store in cache
    await this.redis.setex(cacheKey, 3600, JSON.stringify(user));

    return user;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.update(id, data);
    
    // Invalidate cache
    await this.redis.del(`user:${id}`);
    
    return user;
  }
}
```

**After:**

```typescript
import { Cached, CacheEvict } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 3600 })
  async getUser(id: string): Promise<User> {
    return this.userRepository.findById(id);
  }

  @CacheEvict({ keys: ['user:{id}'] })
  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    return this.userRepository.update(id, data);
  }
}
```

### Step 4: Migrate Lock Logic

**Before:**

```typescript
@Injectable()
export class PaymentService {
  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  async processPayment(orderId: string): Promise<void> {
    const lockKey = `lock:payment:${orderId}`;
    const lockValue = uuid();
    const lockTtl = 30;

    // Acquire lock
    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      'EX',
      lockTtl,
      'NX',
    );

    if (!acquired) {
      throw new Error('Could not acquire lock');
    }

    try {
      await this.doPayment(orderId);
    } finally {
      // Release lock (only if we own it)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(script, 1, lockKey, lockValue);
    }
  }
}
```

**After:**

```typescript
import { WithLock } from '@nestjs-redisx/locks';

@Injectable()
export class PaymentService {
  @WithLock({ key: 'payment:{0}', ttl: 30000 })
  async processPayment(orderId: string): Promise<void> {
    await this.doPayment(orderId);
  }
}
```

### Step 5: Access Raw ioredis (When Needed)

You can still access the raw ioredis client:

```typescript
import { InjectRedis } from '@nestjs-redisx/core';
import Redis from 'ioredis';

@Injectable()
export class CustomService {
  constructor(@InjectRedis() private redis: Redis) {}

  async customOperation(): Promise<void> {
    // Use ioredis directly for custom operations
    await this.redis.hset('myhash', 'field', 'value');
    
    // Pipelines
    const pipeline = this.redis.pipeline();
    pipeline.incr('counter1');
    pipeline.incr('counter2');
    await pipeline.exec();

    // Lua scripts
    await this.redis.eval('return 1', 0);
  }
}
```

## Pattern Mapping

| ioredis Pattern | RedisX Pattern |
|-----------------|----------------|
| `redis.get/set` for cache | `@Cached` decorator |
| `redis.set(..., 'NX')` for locks | `@WithLock` decorator |
| `redis.incr` for rate limiting | `@RateLimit` decorator |
| `redis.xadd/xread` for streams | `@StreamConsumer` decorator |

## Gradual Migration

You can migrate incrementally:

```typescript
@Injectable()
export class HybridService {
  constructor(
    @InjectRedis() private redis: Redis,  // Raw access
    @Inject(CACHE_SERVICE) private cache: ICacheService,  // RedisX cache
  ) {}

  // New code: use RedisX
  @Cached({ key: 'new-feature:{0}' })
  async newFeature(id: string) { }

  // Legacy code: still using raw ioredis
  async legacyFeature(id: string) {
    return this.redis.get(`legacy:${id}`);
  }
}
```

## Testing After Migration

```typescript
describe('UserService', () => {
  it('should cache user', async () => {
    // First call - cache miss
    const user1 = await service.getUser('123');
    expect(repository.findById).toHaveBeenCalledTimes(1);

    // Second call - cache hit
    const user2 = await service.getUser('123');
    expect(repository.findById).toHaveBeenCalledTimes(1); // Still 1
  });

  it('should invalidate on update', async () => {
    await service.getUser('123'); // Populate cache
    await service.updateUser('123', { name: 'New' });
    await service.getUser('123'); // Should hit DB

    expect(repository.findById).toHaveBeenCalledTimes(2);
  });
});
```

## Benefits After Migration

| Benefit | Description |
|---------|-------------|
| Less boilerplate | Declarative patterns vs imperative |
| Built-in best practices | Stampede protection, proper TTL |
| Observability | Automatic metrics and tracing |
| Type safety | TypeScript-first decorators |
| Testability | Easy mocking with DI |

## Next Steps

- [Cache Reference](../../reference/cache/) — Full caching API
- [Locks Reference](../../reference/locks/) — Full locks API
- [Two-Tier Caching](../concepts/two-tier-caching) — L1/L2 benefits
