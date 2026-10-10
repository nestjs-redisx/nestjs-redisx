---
title: 'Counters Service API | NestJS RedisX'
description: 'ICounterService: increment, decrement, get, set, reset, getAndReset, next, current — semantics and failure modes.'
---

# Service API

Inject with the `COUNTER_SERVICE` token:

<<< @/apps/demo/src/plugins/counters/service.usage.ts{typescript}

## `ICounterService`

| Method | Description |
|--------|-------------|
| `increment(key, by = 1, { ttl }?)` | Atomic add; returns the new value. With `ttl`: first-write window semantics |
| `decrement(key, by = 1, { ttl }?)` | Atomic subtract; counters go negative freely |
| `get(key)` | Current value; `0` when absent |
| `set(key, value, { ttl }?)` | Absolute assignment; **without** `ttl` an existing window TTL is preserved (a mid-window correction never makes the key permanent) |
| `reset(key)` | Delete; `true` when a counter existed |
| `getAndReset(key)` | Atomic read-and-zero (Lua); `0` when absent |
| `next(sequence)` | Monotonic sequence value (INCR, never a TTL) |
| `current(sequence)` | Last issued value; `0` before the first `next()` |

## Window Semantics (`ttl`)

The TTL is applied **only when the mutation creates the key** (atomic Lua: `EXISTS` check before `INCRBY`, `PEXPIRE` only on creation — a pre-existing permanent counter is never retrofitted with a window):

<<< @/apps/demo/src/plugins/counters/window.usage.ts{typescript}

The window is anchored to the FIRST write — later increments never push it forward, so a daily key expires a day after its first event, not its last. For calendar-aligned windows, put the period in the key (`:2026-10-09`).

## Sequences

<<< @/apps/demo/src/plugins/counters/sequences.usage.ts{typescript}

Values are strictly monotonic and collision-free across instances. They are **not gapless** — a crashed consumer may abandon a value; ledgers that demand gapless numbering need an application-level protocol, not a counter.

## Poisoned Keys

`get`, `current`, and `getAndReset` throw `CounterValueError` (code `OP_TYPE_MISMATCH`) when the key holds a non-numeric value — a shared-key wiring bug fails loudly instead of leaking `NaN` into aggregates. Mutations on such keys fail inside Redis itself (`CommandError`).
