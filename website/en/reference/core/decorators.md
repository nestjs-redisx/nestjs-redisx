---
title: Decorators
description: "@InjectRedis decorator for dependency injection"
---

# Decorators

Inject Redis clients directly into your services.

## @InjectRedis

Inject Redis driver instance by name.

### Basic Usage

<<< @/apps/demo/src/core/decorators/inject-default.usage.ts{typescript}

### Named Client

<<< @/apps/demo/src/core/decorators/inject-named.usage.ts{typescript}

### Multiple Injections

<<< @/apps/demo/src/core/decorators/inject-multiple.usage.ts{typescript}

## @InjectRedis vs RedisService

### When to Use @InjectRedis

- Direct driver access needed
- Working with specific named clients
- Lower-level Redis operations
- Custom wrapper services

<<< @/apps/demo/src/core/decorators/low-level-cache.usage.ts{typescript}

### When to Use RedisService

- Simple Redis operations
- Default client is sufficient
- Higher-level API preferred
- Dynamic client selection

<<< @/apps/demo/src/core/decorators/high-level-cache.usage.ts{typescript}

## Injection Tokens

### CLIENT_MANAGER

Inject the client manager directly:

<<< @/apps/demo/src/core/decorators/client-manager-inject.usage.ts{typescript}

### Custom Tokens

<<< @/apps/demo/src/core/decorators/custom-tokens.usage.ts{typescript}

## Type Safety

### IRedisDriver Interface

The `IRedisDriver` interface provides full type safety:

```typescript
interface IRedisDriver {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ping(message?: string): Promise<string>;

  // String commands
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: ISetOptions): Promise<'OK' | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  mset(data: Record<string, string>): Promise<'OK'>;

  // Hash commands
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;

  // List commands
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpop(key: string): Promise<string | null>;

  // Set commands
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;

  // Sorted set commands
  zadd(key: string, ...args: Array<number | string>): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;

  // Transaction commands
  pipeline(): IPipeline;
  multi(): IMulti;

  // Lua scripts
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;

  // ... and more
}
```

### ISetOptions

```typescript
interface ISetOptions {
  ex?: number;      // Expiration in seconds
  px?: number;      // Expiration in milliseconds
  exat?: number;    // Expiration Unix timestamp (seconds)
  pxat?: number;    // Expiration Unix timestamp (milliseconds)
  nx?: boolean;     // Only set if not exists
  xx?: boolean;     // Only set if exists
  get?: boolean;    // Return previous value
  keepttl?: boolean; // Keep existing TTL
}
```

## Testing with Decorators

### Mock Injection

```typescript
import { Test } from '@nestjs/testing';
import { getClientToken } from '@nestjs-redisx/core';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: MockedObject<IRedisDriver>;

  beforeEach(async () => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      // ... other methods
    } as unknown as MockedObject<IRedisDriver>;

    const module = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: getClientToken('cache'),
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get(CacheService);
  });

  it('should cache value', async () => {
    mockRedis.set.mockResolvedValue('OK');

    await service.set('key', 'value', 3600);

    expect(mockRedis.set).toHaveBeenCalledWith('key', 'value', { ex: 3600 });
  });
});
```

### Integration Testing

```typescript
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

describe('CacheService (integration)', () => {
  let service: CacheService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: {
            cache: {
              host: 'localhost',
              port: 6379,
            },
          },
        }),
      ],
      providers: [CacheService],
    }).compile();

    service = module.get(CacheService);
  });

  it('should cache and retrieve value', async () => {
    await service.set('test-key', 'test-value', 60);
    const value = await service.get('test-key');
    expect(value).toBe('test-value');
  });
});
```

## Common Patterns

### Repository Pattern

<<< @/apps/demo/src/core/decorators/repository-pattern.usage.ts{typescript}

### Queue Service

<<< @/apps/demo/src/core/decorators/queue-service.usage.ts{typescript}

## Accessing Native Client via Decorator

When you need driver-specific features, inject the native client directly:

::: code-group

```typescript [ioredis]
import { InjectRedis } from '@nestjs-redisx/core';
import Redis from 'ioredis';

@Injectable()
export class CustomService {
  constructor(@InjectRedis() private redis: Redis) {}

  async customOp(): Promise<void> {
    // ioredis-specific: define custom commands
    this.redis.defineCommand('mycommand', {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });
  }
}
```

```typescript [node-redis]
import { InjectRedis } from '@nestjs-redisx/core';
import { RedisClientType } from 'redis';

@Injectable()
export class CustomService {
  constructor(@InjectRedis() private redis: RedisClientType) {}

  async customOp(): Promise<void> {
    // node-redis-specific: send raw command
    await this.redis.sendCommand(['CLIENT', 'INFO']);
  }
}
```

:::

## Next Steps

- [Driver Abstraction](./driver-abstraction) — ioredis vs node-redis
- [RedisService](./redis-service) — High-level API
- [Multiple Clients](./multiple-clients) — Named clients
