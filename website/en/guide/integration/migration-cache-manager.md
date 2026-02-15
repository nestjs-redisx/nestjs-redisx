---
title: Migration from cache-manager
description: Migrate from @nestjs/cache-manager to NestJS RedisX
---

# Migration from @nestjs/cache-manager

Step-by-step guide to migrate from `@nestjs/cache-manager` to NestJS RedisX.

## Comparison

| Feature | cache-manager | NestJS RedisX |
|---------|---------------|---------------|
| Two-tier cache (L1+L2) | ❌ | ✅ |
| Stampede protection | ❌ | ✅ |
| Tag-based invalidation | ❌ | ✅ |
| Stale-while-revalidate | ❌ | ✅ |
| Distributed locks | ❌ | ✅ |
| Rate limiting | ❌ | ✅ |

## Migration Steps

### Step 1: Install Dependencies

```bash
# Remove old
npm uninstall @nestjs/cache-manager cache-manager cache-manager-redis-store

# Install new (choose one driver)
npm install @nestjs-redisx/core @nestjs-redisx/cache ioredis
# or
npm install @nestjs-redisx/core @nestjs-redisx/cache redis
```

### Step 2: Update App Module

**Before:**

```typescript
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      host: 'localhost',
      port: 6379,
      ttl: 60,
    }),
  ],
})
export class AppModule {}
```

**After:**

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CachePlugin({
          l1: { maxSize: 1000, ttl: 60000 },
          l2: { defaultTtl: 60 },
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

### Step 3: Update Service Injection

**Before:**

```typescript
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class UserService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  async getUser(id: string): Promise<User> {
    const cached = await this.cache.get<User>(`user:${id}`);
    if (cached) return cached;

    const user = await this.userRepository.findById(id);
    await this.cache.set(`user:${id}`, user, 3600);
    return user;
  }
}
```

**After (Decorator approach - recommended):**

```typescript
import { Cached } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 3600 })
  async getUser(id: string): Promise<User> {
    return this.userRepository.findById(id);
  }
}
```

**After (Service approach - if you need programmatic control):**

```typescript
import { CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  constructor(@Inject(CACHE_SERVICE) private cache: ICacheService) {}

  async getUser(id: string): Promise<User> {
    return this.cache.get(`user:${id}`, {
      loader: () => this.userRepository.findById(id),
      ttl: 3600,
    });
  }
}
```

### Step 4: Update Interceptor Usage

**Before:**

```typescript
import { CacheInterceptor } from '@nestjs/cache-manager';

@Controller('users')
@UseInterceptors(CacheInterceptor)
export class UserController {
  @Get(':id')
  getUser(@Param('id') id: string) {
    return this.userService.getUser(id);
  }
}
```

**After:**

```typescript
import { Cached } from '@nestjs-redisx/cache';

@Controller('users')
export class UserController {
  @Get(':id')
  @Cached({ key: 'user:{0}', ttl: 300 })
  getUser(@Param('id') id: string) {
    return this.userService.getUser(id);
  }
}
```

### Step 5: Update Cache Invalidation

**Before:**

```typescript
async updateUser(id: string, data: UpdateUserDto): Promise<User> {
  const user = await this.userRepository.update(id, data);
  await this.cache.del(`user:${id}`);
  return user;
}
```

**After:**

```typescript
@CacheEvict({ keys: ['user:{id}'], tags: ['users'] })
async updateUser(id: string, data: UpdateUserDto): Promise<User> {
  return this.userRepository.update(id, data);
}
```

## API Mapping

| cache-manager | NestJS RedisX |
|---------------|---------------|
| `cache.get(key)` | `cache.get(key)` or `@Cached` |
| `cache.set(key, value, ttl)` | `cache.set(key, value, { ttl })` |
| `cache.del(key)` | `cache.delete(key)` or `@CacheEvict` |
| `cache.reset()` | `cache.clear()` |
| `@CacheKey()` | `@Cached({ key: '...' })` |
| `@CacheTTL()` | `@Cached({ ttl: ... })` |

## New Features to Explore

After migration, you can use these new features:

### Tag-Based Invalidation

```typescript
@Cached({
  key: 'user:{0}',
  tags: (id) => ['users', `user:${id}`],
})
async getUser(id: string) { }

// Invalidate all users
await cache.invalidateTags(['users']);
```

### Stampede Protection

```typescript
@Cached({
  key: 'popular:item',
  stampede: true, // Prevents thundering herd
})
async getPopularItem() { }
```

### Stale-While-Revalidate

```typescript
@Cached({
  key: 'dashboard',
  ttl: 60,
  swr: true,
  staleTime: 300, // Serve stale for 5 min while refreshing
})
async getDashboard() { }
```

## Testing

Update your tests:

```typescript
// Before
const module = await Test.createTestingModule({
  imports: [CacheModule.register()],
}).compile();

// After
const module = await Test.createTestingModule({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new CachePlugin()],
    }),
  ],
}).compile();
```

## Checklist

- [ ] Dependencies updated
- [ ] App module configured
- [ ] Services migrated
- [ ] Controllers updated
- [ ] Cache invalidation updated
- [ ] Tests updated
- [ ] Environment variables updated (if needed)

## Next Steps

- [Two-Tier Caching](../concepts/two-tier-caching) — Understand L1/L2
- [Cache Reference](../../reference/cache/) — Full API documentation
