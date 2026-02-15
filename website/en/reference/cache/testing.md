---
title: Testing
description: Testing cached services and cache behavior
---

# Testing

How to test services that use caching.

::: info Vitest, not Jest
NestJS RedisX uses **Vitest** for all tests. Use `vi.fn()` instead of `jest.fn()`, and `MockedObject<T>` from `vitest` for typed mocks. All test examples follow the **Given-When-Then** pattern.
:::

## Mocking CacheService

The package does **not** export pre-built test mocks. Create mocks inline based on which injection style you use.

### Option 1: Mock CacheService class (recommended)

If your service injects `CacheService` directly:

```typescript
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CacheService } from '@nestjs-redisx/cache';

describe('UserService', () => {
  let service: UserService;
  let cache: MockedObject<CacheService>;

  beforeEach(() => {
    cache = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      getOrSet: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      deleteMany: vi.fn(),
      has: vi.fn(),
      ttl: vi.fn(),
      clear: vi.fn(),
      invalidate: vi.fn(),
      invalidateTags: vi.fn(),
      invalidateByPattern: vi.fn(),
      getKeysByTag: vi.fn(),
      getStats: vi.fn(),
      wrap: vi.fn(),
    } as unknown as MockedObject<CacheService>;

    service = new UserService(cache);
  });
});
```

### Option 2: Mock ICacheService via token

If your service uses `@Inject(CACHE_SERVICE)`:

```typescript
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CACHE_SERVICE, type ICacheService } from '@nestjs-redisx/cache';

describe('UserService', () => {
  let service: UserService;
  let cache: MockedObject<ICacheService>;

  beforeEach(() => {
    cache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),       // ICacheService uses 'delete', not 'del'
      getOrSet: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      deleteMany: vi.fn(),
      has: vi.fn(),
      ttl: vi.fn(),
      clear: vi.fn(),
      invalidateTag: vi.fn(),   // ICacheService uses 'invalidateTag', not 'invalidate'
      invalidateTags: vi.fn(),
      invalidateByPattern: vi.fn(),
      getKeysByTag: vi.fn(),
      getStats: vi.fn(),
    } as unknown as MockedObject<ICacheService>;

    service = new UserService(cache);
  });
});
```

::: warning CacheService vs ICacheService method names
The public `CacheService` facade uses `del()` and `invalidate()`. The internal `ICacheService` interface uses `delete()` and `invalidateTag()`. Match the mock to the interface you're testing against.
:::

## Testing getOrSet() (most common)

Most real-world code uses `getOrSet()`. Here's how to mock it:

```typescript
describe('UserService', () => {
  let service: UserService;
  let cache: MockedObject<CacheService>;
  let repository: MockedObject<UserRepository>;

  beforeEach(() => {
    cache = { getOrSet: vi.fn() } as unknown as MockedObject<CacheService>;
    repository = { findOne: vi.fn() } as unknown as MockedObject<UserRepository>;
    service = new UserService(cache, repository);
  });

  it('should call getOrSet with correct key and loader', async () => {
    // Given
    const user = { id: '123', name: 'John' };
    cache.getOrSet.mockResolvedValue(user);

    // When
    const result = await service.getUser('123');

    // Then
    expect(result).toEqual(user);
    expect(cache.getOrSet).toHaveBeenCalledWith(
      'user:123',
      expect.any(Function),  // loader
      expect.objectContaining({ ttl: 3600 }),
    );
  });

  it('should call loader when cache misses', async () => {
    // Given
    const user = { id: '123', name: 'John' };
    repository.findOne.mockResolvedValue(user);

    // Mock getOrSet to actually call the loader
    cache.getOrSet.mockImplementation(async (key, loader) => {
      return loader();
    });

    // When
    const result = await service.getUser('123');

    // Then
    expect(repository.findOne).toHaveBeenCalledWith('123');
    expect(result).toEqual(user);
  });
});
```

## Testing get/set Pattern

```typescript
describe('ProductService', () => {
  let service: ProductService;
  let cache: MockedObject<CacheService>;

  beforeEach(() => {
    cache = {
      get: vi.fn(),
      set: vi.fn(),
    } as unknown as MockedObject<CacheService>;
    service = new ProductService(cache);
  });

  it('should return cached value on hit', async () => {
    // Given
    const product = { id: '1', name: 'Laptop' };
    cache.get.mockResolvedValue(product);

    // When
    const result = await service.getProduct('1');

    // Then
    expect(result).toEqual(product);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('should load and cache on miss', async () => {
    // Given
    cache.get.mockResolvedValue(null);

    // When
    await service.getProduct('1');

    // Then
    expect(cache.set).toHaveBeenCalledWith(
      'product:1',
      expect.any(Object),
      expect.objectContaining({ ttl: 3600 }),
    );
  });
});
```

## Testing @Cached Decorator

`@Cached` is proxy-based — it intercepts the method at the class level. To test it properly, you need the real decorator behavior:

### Unit test: verify decorator metadata

```typescript
import { describe, it, expect } from 'vitest';
import { CACHE_OPTIONS_KEY } from '@nestjs-redisx/cache';

describe('@Cached metadata', () => {
  it('should store cache options in metadata', () => {
    // Given
    const instance = new UserService();

    // When
    const metadata = Reflect.getMetadata(
      CACHE_OPTIONS_KEY,
      instance,
      'getUser',
    );

    // Then
    expect(metadata).toMatchObject({
      key: expect.any(String),
      ttl: 300,
    });
  });
});
```

### Functional test: verify memoization

Test that the underlying method is called only once (decorator caches the result):

```typescript
describe('@Cached behavior', () => {
  let service: UserService;
  let repositorySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new UserService(repository, cacheService);
    repositorySpy = vi.spyOn(repository, 'findOne');
  });

  it('should call repository only once for same key', async () => {
    // Given
    repositorySpy.mockResolvedValue({ id: '123', name: 'John' });

    // When
    await service.getUser('123');
    await service.getUser('123');

    // Then — repository called once, second call served from cache
    expect(repositorySpy).toHaveBeenCalledTimes(1);
  });

  it('should call repository for different keys', async () => {
    // Given
    repositorySpy.mockResolvedValue({ id: '123', name: 'John' });

    // When
    await service.getUser('123');
    await service.getUser('456');

    // Then
    expect(repositorySpy).toHaveBeenCalledTimes(2);
  });
});
```

## Testing Tag Invalidation

### Service that calls invalidateTags directly

```typescript
describe('UserService.updateUser', () => {
  it('should invalidate user tags after update', async () => {
    // Given
    cache.invalidateTags.mockResolvedValue(3);

    // When
    await service.updateUser('123', { name: 'Jane' });

    // Then
    expect(cache.invalidateTags).toHaveBeenCalledWith(
      expect.arrayContaining(['user:123', 'users']),
    );
  });
});
```

### @InvalidateTags decorator

`@InvalidateTags` is proxy-based — it calls `invalidateTags()` through the interceptor internally. To test, verify the **effect** rather than the interceptor call:

```typescript
describe('@InvalidateTags', () => {
  it('should invalidate cache when method succeeds', async () => {
    // Given — cache a user first
    cache.getOrSet.mockResolvedValue({ id: '123', name: 'John' });
    await service.getUser('123');

    // When — update triggers @InvalidateTags
    await service.updateUser('123', { name: 'Jane' });

    // Then — next get should miss cache (re-load from DB)
    cache.getOrSet.mockImplementation(async (_key, loader) => loader());
    const result = await service.getUser('123');
    expect(result.name).toBe('Jane');
  });
});
```

## Integration Tests

Integration tests use a **real Redis** instance via docker-compose.

### Setup

```bash
# Start Redis
docker-compose up -d

# Run integration tests
npm run test:integration

# Stop Redis
docker-compose down
```

### Example

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin, CacheService } from '@nestjs-redisx/cache';

describe('Cache (integration)', () => {
  let app: INestApplication;
  let cache: CacheService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'localhost', port: 6379 },
          plugins: [
            new CachePlugin({
              l1: { enabled: true, maxSize: 100 },
              l2: { enabled: true },
            }),
          ],
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    cache = app.get(CacheService);
  });

  beforeEach(async () => {
    await cache.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should set and get value', async () => {
    // Given
    await cache.set('key', { name: 'test' }, { ttl: 60 });

    // When
    const result = await cache.get<{ name: string }>('key');

    // Then
    expect(result).toEqual({ name: 'test' });
  });

  it('should getOrSet with loader', async () => {
    // Given
    const loader = vi.fn().mockResolvedValue({ id: '1' });

    // When
    const first = await cache.getOrSet('key', loader, { ttl: 60 });
    const second = await cache.getOrSet('key', loader, { ttl: 60 });

    // Then
    expect(first).toEqual({ id: '1' });
    expect(second).toEqual({ id: '1' });
    expect(loader).toHaveBeenCalledTimes(1);  // Loaded once, cached second time
  });

  it('should invalidate by tag', async () => {
    // Given
    await cache.set('user:1', { id: '1' }, { ttl: 60, tags: ['users'] });
    await cache.set('user:2', { id: '2' }, { ttl: 60, tags: ['users'] });

    // When
    await cache.invalidate('users');

    // Then
    expect(await cache.get('user:1')).toBeNull();
    expect(await cache.get('user:2')).toBeNull();
  });
});
```

::: warning Integration tests require Redis
Integration tests need a running Redis instance. Use `docker-compose up -d` from the project root. Tests with `l2: { enabled: false }` still require a Redis connection for the driver injection.
:::

## Best Practices

### Do
- Mock `CacheService` or `ICacheService` — don't test cache internals
- Test **behavior** (method called N times, correct key) not **implementation**
- Use `mockImplementation` on `getOrSet` to test loader logic
- Use Given-When-Then comments in every test
- Clear cache in `beforeEach` for integration tests

### Don't
- Don't mock L1/L2 stores directly in service tests — mock the facade
- Don't test decorator metadata as a substitute for behavior tests
- Don't use `jest.fn()` — use `vi.fn()` (Vitest)
- Don't assume cache state between tests — always set up fresh state

## Next Steps

- [Recipes](./recipes) — Common caching patterns
- [Troubleshooting](./troubleshooting) — Debug issues
