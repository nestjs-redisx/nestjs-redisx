---
title: Eviction Strategies
description: Memory management and cache eviction policies
---

# Eviction Strategies

How cache entries are evicted when L1 memory cache is full.

## How L1 Eviction Works

L1 (memory) cache uses a **doubly-linked list** with a `Map` for O(1) lookups. Each node stores the entry, an expiration timestamp, and a frequency counter.

Two eviction triggers:

| Trigger | When | Behavior |
|---------|------|----------|
| **TTL expiration** | `get()` or `has()` finds expired entry | Entry removed immediately (lazy cleanup) |
| **Max size reached** | `set()` when `cache.size >= maxSize` | One entry evicted by policy before insert |

::: info TTL and maxSize are independent
L1 entries have their own TTL (default: 60s, configurable via `l1.ttl`). Expired entries are evicted on access regardless of maxSize. The eviction policy (`lru` / `lfu`) only applies when the cache is full.
:::

## Configuration

```typescript
new CachePlugin({
  l1: {
    enabled: true,
    maxSize: 1000,           // Max entries in memory (default: 1000)
    ttl: 60,                 // L1 TTL in seconds (default: 60)
    evictionPolicy: 'lru',   // 'lru' | 'lfu' (default: 'lru')
  },
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxSize` | `1000` | Maximum number of entries in L1 cache |
| `ttl` | `60` | L1 entry TTL in seconds |
| `evictionPolicy` | `'lru'` | Eviction policy: `'lru'` or `'lfu'` |

## LRU (Least Recently Used) — Default

Evicts the entry that hasn't been accessed for the longest time.

**Implementation:** Doubly-linked list. On every `get()` or `set()` (update), the node is moved to the **head** (`moveToFront`). The **tail** is always the least recently used — evicted first.

```
Head (most recent) ←→ ... ←→ ... ←→ Tail (least recent = evict candidate)
```

**Best for:**
- General use cases
- Hot data frequently accessed
- Unpredictable access patterns

### LRU Example

```
Cache (max 3): [A, B, C]   (A = most recent, C = least recent)

1. get(C)  → [C, A, B]     C moves to head
2. set(D)  → evict B (tail) → [D, C, A]
3. get(A)  → [A, D, C]     A moves to head
4. set(E)  → evict C (tail) → [E, A, D]
```

## LFU (Least Frequently Used)

Evicts the entry that has been accessed the fewest times.

**Implementation:** Each node has a `frequency` counter (starts at 1 on insert). On every `get()` or `set()` (update), frequency is incremented. On eviction, the node with the lowest frequency is selected. **Tiebreaker:** when frequencies are equal, the entry closest to the tail (oldest by insertion) is evicted.

**Best for:**
- Workloads with clear hot/cold data
- When some entries are consistently popular
- Long-running caches where frequency matters more than recency

### LFU Example

```
Cache (max 3): A(freq=5), B(freq=2), C(freq=3)

1. set(D)  → evict B (lowest freq=2) → A(5), C(3), D(1)
2. get(D)  → D freq: 1→2             → A(5), C(3), D(2)
3. get(D)  → D freq: 2→3             → A(5), C(3), D(3)
4. set(E)  → C and D both freq=3, evict older → A(5), D(3), E(1)
```

## LRU vs LFU

| Aspect | LRU | LFU |
|--------|-----|-----|
| Tracks | Access order (linked list position) | Access frequency (counter) |
| On read | Moves node to head | Increments frequency |
| Evicts | Tail node (oldest access) | Lowest frequency (tiebreak: oldest insert) |
| Best for | General use, recency matters | Stable popularity patterns |
| Weakness | Scan pollution (one-time reads push out hot data) | Slow to adapt to popularity changes |
| Eviction complexity | O(1) — always tail | O(n) — scan all nodes for min frequency |

## Standalone Strategy Utilities

The package also exports standalone strategy classes implementing the `IEvictionStrategy` interface. These are **not used by the L1 adapter internally** — they are utilities for building custom cache implementations.

```typescript
import {
  type IEvictionStrategy,
  LruStrategy,
  LfuStrategy,
  FifoStrategy,
} from '@nestjs-redisx/cache';
```

### IEvictionStrategy Interface

| Method | Description |
|--------|-------------|
| `recordAccess(key)` | Record that a key was accessed |
| `recordInsert(key)` | Record that a key was inserted |
| `recordDelete(key)` | Record that a key was deleted |
| `selectVictim()` | Select key to evict (returns `undefined` if empty) |
| `clear()` | Clear all tracking data |
| `size()` | Get number of tracked keys |

All three strategies also provide:
- `getKeys()` — all keys in eviction order (first = next victim)
- `getVictims(targetSize)` — keys to evict to reach target size

### Available Strategies

| Class | Config equivalent | Description |
|-------|-------------------|-------------|
| `LruStrategy` | `evictionPolicy: 'lru'` | Timestamp-based LRU |
| `LfuStrategy` | `evictionPolicy: 'lfu'` | Frequency counter with insertion-order tiebreaker |
| `FifoStrategy` | *(not configurable)* | Simple queue — insertion order only, `recordAccess` is a no-op |

::: info FIFO is utility-only
`FifoStrategy` is exported for custom use but **not available** via `evictionPolicy` config. The L1 adapter only supports `'lru'` and `'lfu'`.
:::

### Usage Example

```typescript
const lru = new LruStrategy<string>();

lru.recordInsert('key1');
lru.recordInsert('key2');
lru.recordInsert('key3');

lru.recordAccess('key1');  // key1 becomes most recent

lru.selectVictim();  // 'key2' (least recently used)

// Evict down to 2 entries
lru.getVictims(2);   // ['key2']
```

```typescript
const lfu = new LfuStrategy<string>();

lfu.recordInsert('key1');
lfu.recordInsert('key2');

lfu.recordAccess('key1');  // freq: 1→2
lfu.recordAccess('key1');  // freq: 2→3

lfu.selectVictim();        // 'key2' (freq=1, lowest)
lfu.getFrequency('key1');  // 3
```

## L2 Eviction (Redis)

Redis manages its own memory with `maxmemory-policy`. This is configured in `redis.conf`, not in the plugin.

| Policy | Description | Best For |
|--------|-------------|----------|
| `volatile-lru` | Evict LRU keys with TTL | General use (recommended) |
| `allkeys-lru` | Evict any LRU keys | All data has similar importance |
| `volatile-ttl` | Evict keys with shortest TTL | Time-sensitive data |
| `volatile-random` | Evict random keys with TTL | No clear pattern |
| `allkeys-random` | Evict any random keys | All data equal |
| `noeviction` | Return error when full | Critical data, never evict |

```bash
# redis.conf
maxmemory 2gb
maxmemory-policy volatile-lru
maxmemory-samples 5
```

## Best Practices

### Do
- Use **LRU** for most cases — it's simpler and O(1) eviction
- Use **LFU** when you have clear hot/cold separation and want hot data to survive
- Monitor hit rates via `getStats()` — if hit rate < 50%, consider increasing `maxSize`
- Set L1 TTL shorter than L2 TTL to keep memory bounded

### Don't
- Set `maxSize` too low — causes thrashing (constant evict/insert)
- Use `noeviction` in Redis without monitoring memory usage
- Assume L1 TTL = L2 TTL — they are independent (L1 default: 60s, L2 default: 3600s)

## Next Steps

- [Monitoring](./monitoring) — Track cache performance
- [Testing](./testing) — Test cache behavior
