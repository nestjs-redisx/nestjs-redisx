---
title: Configuration
description: Complete configuration reference for Locks Plugin
---

# Configuration

Full reference for all Locks Plugin options.

## Basic Configuration

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new LocksPlugin({
          // Your options here
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

## Complete Options Reference

```typescript
new LocksPlugin({
  // TTL Settings
  defaultTtl: 30000,       // Default TTL for locks (ms)
  maxTtl: 300000,          // Maximum allowed TTL (ms)

  // Key Settings
  keyPrefix: '_lock:',     // Prefix for all lock keys

  // Retry Configuration
  retry: {
    maxRetries: 3,         // Maximum retry attempts
    initialDelay: 100,     // Initial delay (ms)
    maxDelay: 3000,        // Max delay (ms)
    multiplier: 2,         // Exponential backoff multiplier
  },

  // Auto-Renewal Configuration
  autoRenew: {
    enabled: true,         // Enable auto-renewal
    intervalFraction: 0.5, // Renew at 50% of TTL
  },
})
```

## Configuration by Use Case

### High-Contention (Many Workers)

```typescript
new LocksPlugin({
  defaultTtl: 10000,    // Shorter locks
  retry: {
    maxRetries: 10,     // More retries
    initialDelay: 50,   // Quick first retry
    maxDelay: 2000,     // Cap wait time
    multiplier: 1.5,    // Gentler backoff
  },
  autoRenew: {
    enabled: true,
  },
})
```

### Long-Running Tasks

```typescript
new LocksPlugin({
  defaultTtl: 60000,    // 1 minute
  maxTtl: 600000,       // Allow up to 10 min
  autoRenew: {
    enabled: true,      // Must enable
    intervalFraction: 0.3, // Renew more frequently
  },
})
```

### Low-Contention (Few Workers)

```typescript
new LocksPlugin({
  defaultTtl: 30000,
  retry: {
    maxRetries: 2,      // Fewer retries
    initialDelay: 200,  // Slower retry
    multiplier: 3,      // Aggressive backoff
  },
})
```

## Environment-Based Configuration

<<< @/apps/demo/src/plugins/locks/env-config.setup.ts{typescript}

## Next Steps

- [Decorator](./decorator) — Learn @WithLock decorator
- [Service API](./service-api) — Programmatic lock access
