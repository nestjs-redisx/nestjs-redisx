---
title: Configuration
description: Complete configuration reference for Idempotency Plugin
---

# Configuration

Full reference for all Idempotency Plugin options.

## Basic Configuration

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new IdempotencyPlugin({
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
new IdempotencyPlugin({
  // Basic Settings
  defaultTtl: 86400,
  keyPrefix: 'idempotency:',
  headerName: 'Idempotency-Key',

  // Timeout Settings
  lockTimeout: 30000,
  waitTimeout: 60000,

  // Fingerprinting
  validateFingerprint: true,
  fingerprintFields: ['method', 'path', 'body'],
  fingerprintGenerator: async (context) => {
    const req = context.switchToHttp().getRequest();
    return createHash('sha256')
      .update(`${req.method}|${req.path}|${JSON.stringify(req.body)}`)
      .digest('hex');
  },

  // Error Handling
  errorPolicy: 'fail-closed',
})
```

## Configuration by Use Case

### Payment Processing (Strict)

```typescript
new IdempotencyPlugin({
  defaultTtl: 86400,         // 24 hours
  lockTimeout: 60000,        // 1 minute (payments can be slow)
  waitTimeout: 120000,       // 2 minutes
  validateFingerprint: true, // Strict validation
  errorPolicy: 'fail-closed',
})
```

### Order Creation (Standard)

```typescript
new IdempotencyPlugin({
  defaultTtl: 3600,          // 1 hour
  lockTimeout: 30000,        // 30 seconds
  waitTimeout: 60000,        // 1 minute
  validateFingerprint: true,
})
```

### Webhook Handling (Lenient)

```typescript
new IdempotencyPlugin({
  defaultTtl: 86400,
  headerName: 'X-Webhook-ID',  // Custom header
  validateFingerprint: false,  // Body may vary
  errorPolicy: 'fail-open',    // Don't require key
})
```

## Environment Configuration

```typescript
// config/idempotency.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('idempotency', () => ({
  ttl: parseInt(process.env.IDEMPOTENCY_TTL || '86400', 10),
  headerName: process.env.IDEMPOTENCY_HEADER || 'Idempotency-Key',
  keyPrefix: process.env.IDEMPOTENCY_PREFIX || 'idempotency:',
  lockTimeout: parseInt(process.env.IDEMPOTENCY_LOCK_TIMEOUT || '30000', 10),
  waitTimeout: parseInt(process.env.IDEMPOTENCY_WAIT_TIMEOUT || '60000', 10),
}));
```

```bash
# .env
IDEMPOTENCY_TTL=86400
IDEMPOTENCY_HEADER=Idempotency-Key
IDEMPOTENCY_LOCK_TIMEOUT=30000
IDEMPOTENCY_WAIT_TIMEOUT=60000
```

## Options Deep Dive

### TTL Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultTtl` | number | `86400` | Record lifetime (seconds) |

**TTL Guidelines:**

| Operation Type | Recommended TTL | Reason |
|----------------|-----------------|--------|
| Payments | 24-48 hours | Important, may retry next day |
| Orders | 1-24 hours | Session-based |
| Notifications | 1-4 hours | Time-sensitive |
| Webhooks | 24-72 hours | May replay |

### Timeout Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lockTimeout` | number | `30000` | Max processing time (ms) |
| `waitTimeout` | number | `60000` | Max wait for concurrent (ms) |

**Timeout Relationship:**

```
waitTimeout >= lockTimeout + safety_margin

Recommended: waitTimeout = lockTimeout * 2
```

### Fingerprint Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validateFingerprint` | boolean | `true` | Check request matches |
| `fingerprintFields` | array | `['method', 'path', 'body']` | Fields to hash |
| `fingerprintGenerator` | function | undefined | Custom hash function |

## Next Steps

- [Decorator](./decorator) — Learn @Idempotent decorator
- [Fingerprinting](./fingerprinting) — Deep dive into fingerprints
