---
title: 'Counters Troubleshooting | NestJS RedisX'
description: 'Windows that never expire, CounterValueError on shared keys, sequence gaps, and 64-bit overflow.'
---

# Troubleshooting

## The window counter never expires

The TTL is applied only by the mutation that **creates** the key. If the key was first written by `set()` *without* a TTL (or by another system), later `increment(..., { ttl })` calls will not add one. Check `PTTL` on the raw key; recreate it through the windowed increment.

## `CounterValueError: holds a non-numeric value`

The counter key is shared with something that wrote a string — usually a prefix collision. Counters live under `keyPrefix` (default `_ctr:`); if another subsystem writes the same full key, separate the prefixes. The loud error is deliberate: silently returning `NaN` would poison every downstream aggregate.

## Sequence has gaps

`next()` is monotonic and collision-free, **not gapless**: a consumer that crashed after taking a value abandons it. If an auditor demands gapless numbering, allocate numbers transactionally in your database at the moment of use — no distributed counter can promise gaplessness.

## `increment` rejects my amount

Amounts must be non-zero safe integers — `Number(process.env.STEP)` with an unset variable is `NaN` and is reported as such. Fractional amounts are rejected by design (Redis counters are 64-bit integers); for floats keep a scaled integer (cents, micros).

## Overflow

Redis counters saturate at ±2⁶³−1 and then error (surfaced as a `CommandError`). If a counter can realistically approach that, flush it periodically with `getAndReset`.
