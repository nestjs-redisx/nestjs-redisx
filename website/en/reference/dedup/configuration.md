---
title: 'Dedup Configuration | NestJS RedisX'
description: 'DedupPlugin options: deduplication windows, errorPolicy fail-open vs fail-closed, key prefix, named clients, async registration.'
---

# Configuration

## Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `string` | `'default'` | Named Redis client to use |
| `keyPrefix` | `string` | `'_dedup:'` | Prefix for marker keys (must be non-empty) |
| `defaultWindow` | `number` | `60000` | Window in ms: repeats after the first occurrence are duplicates for this long |
| `errorPolicy` | `'fail-open' \| 'fail-closed'` | `'fail-open'` | Gate behavior when the store is unreachable |

All options are validated **fail-fast** at registration (and again in the service constructor for hand-wired setups) — an invalid window, unknown policy, or empty prefix throws `InvalidDedupConfigError` before the application starts.

## Synchronous Setup

<<< @/apps/demo/src/plugins/dedup/basic.setup.ts{typescript}

## Async Registration

```typescript
DedupPlugin.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    defaultWindow: config.get<number>('DEDUP_WINDOW_MS') ?? 60_000,
    errorPolicy: 'fail-open',
  }),
}),
```

## `errorPolicy` — choosing a failure direction

Applies **only to the gates** (`dedupe`, `debounce`, `@Dedupe`) when the store is unreachable; `isFirst` and `release` always throw `DedupStoreError`.

| Policy | Store down means | Choose when |
|--------|------------------|-------------|
| `'fail-open'` (default) | The function runs — duplicates become possible for the outage | Duplicate side effects are tolerable (emails, notifications); losing the work is not |
| `'fail-closed'` | `DedupStoreError` is thrown — the work is skipped | A duplicate is worse than a delay (financial postings) — pair with a retry queue |

Every fail-open execution logs a warning, so outages are visible either way.

Two debounce-specific nuances: a **stamp** failure under `fail-open` still waits the quiet window before running (immediate execution would duplicate a healthy instance's round), and a **claim** failure never runs-anyway — `fail-open` skips the round loudly, because running a possibly-superseded round would duplicate the winner's execution.

Keys must not contain `U+0000` (reserved for the internal debounce-slot namespace) — validation rejects it.

## Choosing the Window

The window answers "for how long is a repeat a *duplicate* rather than a *new occurrence*?" — webhook redelivery horizons (minutes), queue redrive policies (your visibility timeout × max receives), or UX double-click guards (seconds). Markers vanish on their own; there is nothing to clean up.
