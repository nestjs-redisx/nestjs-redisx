---
title: Configuration
description: Complete configuration reference for Core module
---

# Configuration

Complete reference for RedisModule configuration options.

## Basic Configuration

```typescript
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
})
export class AppModule {}
```

## Complete Options Reference

```typescript
interface IRedisModuleOptions {
  /**
   * Redis client configurations
   * Single config or map of named clients
   */
  clients: ConnectionConfig | Record<string, ConnectionConfig>;

  /**
   * Registered plugins
   */
  plugins?: IRedisXPlugin[];

  /**
   * Global configuration
   */
  global?: IGlobalConfig;
}
```

## Connection Configuration

All connection types share a common set of base options. Each type adds its own specific fields.

### Base Options

These options are available for all connection types (single, cluster, sentinel):

```typescript
interface IBaseConnectionConfig {
  password?: string;              // Authentication
  db?: number;                    // Database number (0-15), default: 0
  keyPrefix?: string;             // Key prefix for all operations
  connectTimeout?: number;        // Connection timeout (ms), default: 10000
  commandTimeout?: number;        // Command timeout (ms), default: 5000
  keepAlive?: number;             // Keep-alive interval (ms), default: 0 (disabled)
  enableOfflineQueue?: boolean;   // Queue commands when disconnected, default: true
  enableAutoReconnect?: boolean;  // Auto reconnect, default: true
  maxRetriesPerRequest?: number;  // Max retries, default: 3
  retryStrategy?: (times: number) => number | null;      // Custom retry delay
  reconnectOnError?: (error: Error) => boolean | 1 | 2;  // Reconnect condition
}
```

### Single Instance

```typescript
interface ISingleConnectionConfig extends IBaseConnectionConfig {
  type?: 'single';              // Optional, default
  host?: string;                // Default: 'localhost'
  port?: number;                // Default: 6379
  tls?: ITlsConfig;             // TLS configuration
}
```

### Cluster

```typescript
interface IClusterConnectionConfig extends IBaseConnectionConfig {
  type: 'cluster';
  nodes: Array<{ host: string; port: number }>;
  clusterOptions?: {
    maxRedirections?: number;        // Default: 16
    retryDelayOnClusterDown?: number;// Default: 100
    retryDelayOnFailover?: number;   // Default: 100
    scaleReads?: 'master' | 'slave' | 'all';
    enableReadyCheck?: boolean;
    natMap?: Record<string, { host: string; port: number }>;
  };
}
```

### Sentinel

Common sentinel options (both drivers):

```typescript
interface ISentinelConnectionConfig extends IBaseConnectionConfig {
  type: 'sentinel';
  sentinels: Array<{ host: string; port: number }>;
  name: string;                 // Master name
  tls?: ITlsConfig;             // TLS configuration
  sentinelOptions?: {
    enableTLSForSentinelMode?: boolean;
    sentinelPassword?: string;
    sentinelRetryStrategy?: (times: number) => number | null;
    // Driver-specific options — see examples below
  };
}
```

Driver-specific sentinel options:

::: code-group

```typescript [ioredis]
RedisModule.forRoot({
  clients: {
    type: 'sentinel',
    sentinels: [{ host: 'sentinel-1', port: 26379 }],
    name: 'mymaster',
    sentinelOptions: {
      sentinelPassword: 'secret',
      enableTLSForSentinelMode: true,
      preferredSlaves: false,          // ioredis only
      natMap: {                        // ioredis only
        'redis-master:6379': { host: 'localhost', port: 6379 },
      },
    },
  },
})
```

```typescript [node-redis]
RedisModule.forRoot({
  clients: {
    type: 'sentinel',
    sentinels: [{ host: 'sentinel-1', port: 26379 }],
    name: 'mymaster',
    sentinelOptions: {
      sentinelPassword: 'secret',
      enableTLSForSentinelMode: true,
      masterPoolSize: 1,               // node-redis only
      replicaPoolSize: 0,              // node-redis only
      scanInterval: 10000,             // node-redis only
      maxCommandRediscovers: 16,       // node-redis only
    },
  },
})
```

:::

### TLS Configuration

```typescript
interface ITlsConfig {
  enabled?: boolean;
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
  rejectUnauthorized?: boolean; // Default: true
}
```

## Driver Selection

::: code-group

```typescript [ioredis (default)]
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  // driver defaults to 'ioredis'
})
```

```typescript [node-redis]
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  global: { driver: 'node-redis' },
})
```

:::

## Global Configuration

```typescript
interface IGlobalConfig {
  driver?: 'ioredis' | 'node-redis';// Redis driver, default: 'ioredis'
  debug?: boolean;                  // Enable debug logging
  defaultTtl?: number;              // Default TTL (seconds), default: 3600
  keyPrefix?: string;               // Global key prefix
  gracefulShutdown?: boolean;       // Default: true
  gracefulShutdownTimeout?: number; // Default: 5000 (ms)
  enableHealthChecks?: boolean;     // Default: true
  healthCheckInterval?: number;     // Default: 30000 (ms)
}
```

## Async Configuration

### With Factory

```typescript
import { ConfigService } from '@nestjs/config';

RedisModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    clients: {
      host: config.get('REDIS_HOST'),
      port: config.get('REDIS_PORT'),
      password: config.get('REDIS_PASSWORD'),
    },
  }),
  inject: [ConfigService],
})
```

### With Class

<<< @/apps/demo/src/core/config-factory.usage.ts{typescript}

```typescript
RedisModule.forRootAsync({
  useClass: RedisConfigService,
})
```

### With Existing Provider

```typescript
RedisModule.forRootAsync({
  useExisting: RedisConfigService,
})
```

### With Imports

```typescript
RedisModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    clients: {
      host: config.get('REDIS_HOST'),
      port: config.get('REDIS_PORT'),
    },
  }),
  inject: [ConfigService],
})
```

### With Plugins (Async)

Plugins are provided **outside** `useFactory` — they must be available at module construction time:

<<< @/apps/demo/src/core/plugins-async.setup.ts{typescript}

::: tip Why plugins are outside useFactory?
Plugins must be available at module construction time for NestJS DI to register their providers. This is a standard NestJS pattern — similar to how `@nestjs/typeorm` handles entities or `@nestjs/graphql` handles resolvers.
:::

### Plugin Async Configuration (registerAsync)

Plugins can also resolve their own options from DI, independently from the module-level async config:

<<< @/apps/demo/src/core/plugins-register-async.setup.ts{typescript}

See [Plugin System](./plugin-system#plugin-async-configuration-registerasync) for details.

## Multiple Clients

```typescript
RedisModule.forRoot({
  clients: {
    default: {
      host: 'localhost',
      port: 6379,
    },
    cache: {
      host: 'cache-server',
      port: 6379,
      db: 1,
    },
    sessions: {
      host: 'session-server',
      port: 6379,
      db: 2,
    },
  },
})
```

## With Plugins

```typescript
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';

RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  plugins: [
    new CachePlugin({
      l1: { enabled: true, maxSize: 1000 },
      l2: { defaultTtl: 3600 },
    }),
    new LocksPlugin({
      defaultTtl: 30000,
    }),
    new RateLimitPlugin({
      defaultPoints: 100,
      defaultDuration: 60,
    }),
  ],
})
```

## Environment-Based Configuration

<<< @/apps/demo/src/core/env-config.setup.ts{typescript}

```bash
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret
REDIS_DB=0
REDIS_TLS=false
```

## Configuration Examples

### Development

```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    port: 6379,
  },
  global: {
    debug: true,
  },
})
```

### Production Single Instance

```typescript
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    tls: { enabled: true },
    connectTimeout: 5000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 3,
  },
  global: {
    gracefulShutdown: true,
    gracefulShutdownTimeout: 10000,
  },
})
```

### Production Cluster

```typescript
RedisModule.forRoot({
  clients: {
    type: 'cluster',
    nodes: [
      { host: 'redis-1.example.com', port: 6379 },
      { host: 'redis-2.example.com', port: 6379 },
      { host: 'redis-3.example.com', port: 6379 },
    ],
    password: process.env.REDIS_PASSWORD,
    clusterOptions: {
      maxRedirections: 16,
      scaleReads: 'slave',
    },
  },
})
```

### Production Sentinel

```typescript
RedisModule.forRoot({
  clients: {
    type: 'sentinel',
    sentinels: [
      { host: 'sentinel-1.example.com', port: 26379 },
      { host: 'sentinel-2.example.com', port: 26379 },
      { host: 'sentinel-3.example.com', port: 26379 },
    ],
    name: 'mymaster',
    password: process.env.REDIS_PASSWORD,
    sentinelOptions: {
      sentinelPassword: process.env.SENTINEL_PASSWORD,
    },
  },
})
```

## Next Steps

- [RedisService](./redis-service) — Service API reference
- [Multiple Clients](./multiple-clients) — Named client management
- [Connection Types](./connection-types) — Single, Cluster, Sentinel details
