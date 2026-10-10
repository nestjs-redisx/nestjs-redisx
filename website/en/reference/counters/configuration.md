---
title: 'Counters Configuration | NestJS RedisX'
description: 'CountersPlugin options: key prefix, named clients, async registration, and input validation rules.'
---

# Configuration

## Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `string` | `'default'` | Named Redis client to use |
| `keyPrefix` | `string` | `'_ctr:'` | Prefix for counter keys (must be non-empty) |

The plugin is deliberately thin - behavior lives in per-call options.

## Synchronous Setup

<<< @/apps/demo/src/plugins/counters/basic.setup.ts{typescript}

## Async Registration

```typescript
CountersPlugin.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    keyPrefix: config.get<string>('COUNTERS_PREFIX') ?? '_ctr:',
  }),
}),
```

## Per-Call Options

| Option | Applies to | Description |
|--------|-----------|-------------|
| `ttl` | `increment`, `decrement`, `set` | For mutations: window TTL applied only when the mutation **creates** the key. For `set`: a plain key TTL |

## Validation Rules (fail-fast)

| Input | Rule |
|-------|------|
| `key` / `sequence` | Non-empty string |
| amount (`by`) | Non-zero safe integer (negatives fine) |
| `value` (set) | Safe integer |
| `ttl` | Positive integer milliseconds |

Violations throw `InvalidCounterConfigError` before any Redis round-trip - `Number(unsetEnvVar)` (NaN) is reported truthfully rather than corrupting a counter.
