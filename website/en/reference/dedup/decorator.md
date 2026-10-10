---
title: '@Dedupe Decorator | NestJS RedisX'
description: 'Skip duplicate executions of any @Injectable method within a window: key templates, window override, failure semantics.'
---

# @Dedupe

Proxy-based decorator (same mechanism as `@WithLock`): works on **any** `@Injectable` method.

<<< @/apps/demo/src/plugins/dedup/decorator.usage.ts{typescript}

## Options

| Option | Type | Description |
|--------|------|-------------|
| `key` | `string \| (...args) => string` | Dedup key; `{n}` interpolates the n-th argument |
| `window` | `number?` | Window in ms (default: plugin `defaultWindow`) |

## Semantics

- The first call (per key, across all instances) runs the body and returns its result; repeats within the window resolve `undefined` without running it.
- A **thrown** body releases this caller's marker — the retry is not locked out for the rest of the window.
- Store unavailability follows the plugin [`errorPolicy`](/en/reference/dedup/configuration#errorpolicy-choosing-a-failure-direction).

## Composing with `@Cron`

Both orders are safe — the wrapper carries over metadata stamped by decorators below it, so `@Dedupe()` above `@Cron()` does **not** unregister the job.

## Without the Plugin

If `DedupPlugin` is not registered, the method executes **without deduplication** and logs a warning — fail-open: a possible duplicate is recoverable, a silently skipped business method is not.

## Return Type Caveat

Callers of a deduplicated method must accept `undefined` (the duplicate outcome). If every caller needs the value, deduplicate at the event boundary (the webhook controller) rather than deep in the call chain.
