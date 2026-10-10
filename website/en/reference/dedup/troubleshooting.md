---
title: 'Dedup Troubleshooting | NestJS RedisX'
description: 'Duplicates slipping through, work skipped unexpectedly, debounce rounds that never fire, and policy tuning.'
---

# Troubleshooting

## Duplicates still happen

1. **Different keys** — log the built key; template args that stringify unstably (objects) produce distinct keys per call. Key by the provider's stable id.
2. **Window too short** — redelivery arrived after the marker expired. Match the window to the provider's redelivery horizon.
3. **Store outage under `fail-open`** — every fail-open execution logs `executing WITHOUT deduplication`; if that is unacceptable, switch to `fail-closed`.
4. **A thrown first execution** — by design the marker is released on failure so retries can run; the *successful* execution still happens once.

## Legit work gets skipped

- The window outlives the business reality (an hourly job deduped with a daily window). Lower the window or `release(key)` from support tooling.
- Under `fail-closed`, store outages skip work by policy — pair with a retry queue, or reconsider `fail-open`.

## Debounce never executes

- The **last-calling instance died** before the quiet window elapsed — the pending timer lives in-process by design. The next call starts a new round; for guaranteed execution use a [leader-gated](/en/reference/leader/) cron as a sweep.
- The awaiting caller timed out upstream: `debounce()` resolves only **after** the window — don't call it on a request path with a shorter HTTP timeout.

## `DedupStoreError` from `isFirst`/`release`

Manual APIs are strict by design (the errorPolicy covers only the gates). Catch and decide at the call site — these methods are your steering wheel, not a policy surface.

## Dedup or idempotency?

If the retry needs the original **response**, fingerprint validation, or in-progress coordination — that's [idempotency](/en/reference/idempotency/). If "did this already happen recently?" is the whole question — dedup is lighter and cheaper (one key, one round-trip).
