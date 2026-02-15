---
title: Multiple Clients
description: Managing multiple named Redis connections
---

# Multiple Clients

Manage multiple Redis connections for different purposes.

## Why Multiple Clients?

Common use cases for multiple Redis connections:

- **Separation of concerns** — Cache, sessions, queues on different instances
- **Different databases** — Use Redis DB 0 for cache, DB 1 for sessions
- **Performance isolation** — Heavy operations on dedicated connections
- **Different servers** — Primary for writes, replicas for reads

## Configuration

### Named Clients

<<< @/apps/demo/src/core/multiple-clients/named-clients.setup.ts{typescript}

### Async Configuration

```typescript
RedisModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    clients: {
      default: {
        host: config.get('REDIS_HOST'),
        port: config.get('REDIS_PORT'),
      },
      cache: {
        host: config.get('CACHE_REDIS_HOST'),
        port: config.get('CACHE_REDIS_PORT'),
      },
    },
  }),
  inject: [ConfigService],
})
```

## Accessing Named Clients

### Via RedisService

<<< @/apps/demo/src/core/multiple-clients/multi-client-service.usage.ts{typescript}

### Via @InjectRedis Decorator

<<< @/apps/demo/src/core/multiple-clients/inject-named-client.usage.ts{typescript}

### Via ClientManager

<<< @/apps/demo/src/core/multiple-clients/client-manager-admin.usage.ts{typescript}

## Client Patterns

### Read/Write Separation

```typescript
RedisModule.forRoot({
  clients: {
    write: {
      host: 'redis-primary',
      port: 6379,
    },
    read: {
      host: 'redis-replica',
      port: 6379,
    },
  },
})
```

<<< @/apps/demo/src/core/multiple-clients/read-write-service.usage.ts{typescript}

### Environment-Based Clients

```typescript
RedisModule.forRootAsync({
  useFactory: (config: ConfigService) => {
    const clients: Record<string, ConnectionConfig> = {
      default: {
        host: config.get('REDIS_HOST'),
        port: config.get('REDIS_PORT'),
      },
    };

    // Add cache client only in production
    if (config.get('NODE_ENV') === 'production') {
      clients.cache = {
        host: config.get('CACHE_HOST'),
        port: config.get('CACHE_PORT'),
      };
    }

    return { clients };
  },
  inject: [ConfigService],
})
```

### Different Connection Types

```typescript
RedisModule.forRoot({
  clients: {
    // Single instance for development
    dev: {
      type: 'single',
      host: 'localhost',
      port: 6379,
    },
    // Cluster for production cache
    cache: {
      type: 'cluster',
      nodes: [
        { host: 'cache-1', port: 6379 },
        { host: 'cache-2', port: 6379 },
        { host: 'cache-3', port: 6379 },
      ],
    },
    // Sentinel for HA sessions
    sessions: {
      type: 'sentinel',
      sentinels: [
        { host: 'sentinel-1', port: 26379 },
        { host: 'sentinel-2', port: 26379 },
      ],
      name: 'sessions-master',
    },
  },
})
```

## Client Lifecycle

### Lazy Connection

Clients connect on first use, not at module initialization:

```typescript
// Client not connected yet
const client = await this.redis.getClient('cache');
// Now connected (first use triggers connection)
await client.set('key', 'value');
```

### Connection Status

<<< @/apps/demo/src/core/multiple-clients/monitor-service.usage.ts{typescript}

### Graceful Shutdown

All clients are automatically closed on application shutdown:

```typescript
// Automatic cleanup via onModuleDestroy
// No manual cleanup needed

// For manual cleanup:
await this.clientManager.closeClient('cache');
await this.clientManager.closeAll();
```

## Events

### Listen to Client Events

<<< @/apps/demo/src/core/client-events.usage.ts{typescript}

## Best Practices

### Naming Conventions

```typescript
// Good - descriptive names
clients: {
  cache: { ... },
  sessions: { ... },
  queue: { ... },
  analytics: { ... },
}

// Avoid - generic names
clients: {
  redis1: { ... },
  redis2: { ... },
}
```

### Client per Concern

```typescript
// Good - separate concerns
const cache = await this.redis.getClient('cache');
const sessions = await this.redis.getClient('sessions');

// Avoid - mixing concerns on default client
const client = await this.redis.getClient();
await client.set('cache:user:1', ...);
await client.set('session:abc', ...);
```

### Error Handling

```typescript
async safeGetClient(name: string): Promise<IRedisDriver | null> {
  try {
    return await this.redis.getClient(name);
  } catch (error) {
    this.logger.error(`Failed to get client ${name}:`, error);
    return null;
  }
}
```

## Next Steps

- [Connection Types](./connection-types) — Single, Cluster, Sentinel details
- [Health Monitoring](./health-monitoring) — Monitor client health
- [Decorators](./decorators) — @InjectRedis usage
