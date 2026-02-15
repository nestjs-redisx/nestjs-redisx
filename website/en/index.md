---
layout: home
title: 'NestJS RedisX — Modular Redis Toolkit for NestJS'
description: 'Production-ready Redis module for NestJS with L1+L2 caching, distributed locks, rate limiting, idempotency, streams, and observability. Plugin architecture, TypeScript-first.'

hero:
  name: "NestJS RedisX"
  text: "Redis Toolkit for NestJS"
  tagline: "Caching, distributed locks, rate limiting, and observability — with modular plugin architecture"
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/nestjs-redisx/nestjs-redisx

features:
  - icon:
      src: /icons/blocks.svg
    title: Plugin Architecture
    details: Modular design — import only the features you need. Each plugin is self-contained with its own providers and exports.
    link: /en/reference/plugins/

  - icon:
      src: /icons/layers.svg
    title: L1+L2 Cache
    details: Two-tier caching with in-memory L1 and Redis L2. Includes stampede protection, stale-while-revalidate, and tag-based invalidation.
    link: /en/reference/cache/

  - icon:
      src: /icons/lock.svg
    title: Distributed Locks
    details: Redis-based distributed locking with automatic renewal, ownership validation, and configurable retry strategies.
    link: /en/reference/locks/

  - icon:
      src: /icons/gauge.svg
    title: Rate Limiting
    details: Multiple algorithms including fixed window, sliding window, and token bucket. Supports multi-tenant configurations and custom key strategies.
    link: /en/reference/rate-limit/

  - icon:
      src: /icons/radio.svg
    title: Redis Streams
    details: Full Redis Streams support with consumer groups, dead letter queues, batch processing, and automatic retry with exponential backoff.
    link: /en/reference/streams/

  - icon:
      src: /icons/activity.svg
    title: Built-in Observability
    details: Prometheus metrics, OpenTelemetry distributed tracing, and health checks. Full visibility into your Redis operations.
    link: /en/reference/metrics/
---

## Why NestJS RedisX?

NestJS RedisX provides comprehensive Redis integration for NestJS applications. It implements well-known patterns for caching, locking, and rate limiting with a focus on correctness and developer experience.

- **Production Focused** — Implements proven patterns for distributed systems
- **Type Safe** — Complete TypeScript support with strict typing and IntelliSense
- **Tested** — Comprehensive test suite covering core functionality
- **Documented** — Detailed guides, API reference, and examples
- **Performant** — Optimized for low latency Redis operations
- **Configurable** — Sensible defaults with full customization options

## Ecosystem Comparison

The NestJS ecosystem offers several Redis integration options. This table helps you understand where RedisX fits.

|  | RedisX | @nestjs/cache-manager | @liaoliaots/nestjs-redis | @nestjs-redis/kit | ioredis |
|--|:------:|:---------------------:|:------------------------:|:-----------------:|:-------:|
| **Type** | Plugin Framework | Cache Module | Client Wrapper | Integrations Bundle | Client Library |
| **Underlying Client** | ioredis / node-redis | cache-manager | ioredis | node-redis | — |
| **Actively Maintained** | ✓ | ✓ | ✓ | ✓ | Best-effort |
| | | | | | |
| **Infrastructure** | | | | | |
| Cluster / Sentinel | ✓ | — | ✓ | ✓ | ✓ |
| Multiple Connections | ✓ | — | ✓ | ✓ | Manual |
| Health Checks | ✓ | — | ✓ | ✓ | Manual |
| | | | | | |
| **Caching** | | | | | |
| Basic Cache | ✓ | ✓ | Manual | Manual | Manual |
| L1 + L2 (Memory + Redis) | ✓ | — | — | — | — |
| Stampede Protection | ✓ | — | — | — | — |
| Stale-While-Revalidate | ✓ | — | — | — | — |
| Tag-based Invalidation | ✓ | — | — | — | — |
| | | | | | |
| **Enterprise Patterns** | | | | | |
| Distributed Locks | ✓ | — | — | ✓ | Manual |
| Lock Auto-renewal | ✓ | — | — | — | — |
| Rate Limiting | ✓ | — | — | ~¹ | — |
| Request Idempotency | ✓ | — | — | — | — |
| Streams + Consumer Groups | ✓ | — | — | — | Manual |
| | | | | | |
| **Observability** | | | | | |
| Prometheus Metrics | ✓ | — | — | — | — |
| OpenTelemetry Tracing | ✓ | — | — | — | — |

<small>¹ Throttler storage adapter only — not standalone rate limiting with multiple algorithms</small>

## Quick Example

```typescript
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CachePlugin({
          l1: { maxSize: 1000 },
          l2: { defaultTtl: 3600 },
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

```typescript
import { Injectable } from '@nestjs/common';
import { Cached } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 300 })
  async getUser(id: string): Promise<User> {
    return this.userRepository.findById(id);
  }
}
```

## Core Module

The foundation of NestJS RedisX providing:

- **RedisModule** — NestJS module with sync/async configuration
- **RedisService** — High-level wrapper for Redis operations
- **Multiple Clients** — Named connections for different purposes
- **Connection Types** — Single, Cluster, and Sentinel support
- **Health Monitoring** — Auto-reconnection and statistics
- **Driver Abstraction** — Switch between ioredis and node-redis

[Learn more about Core Module](/en/reference/core/)

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| [Cache](/en/reference/cache/) | 1.0.0 | Two-tier caching with SWR, stampede protection, and tag invalidation |
| [Locks](/en/reference/locks/) | 1.0.0 | Distributed locks with auto-renewal and retry strategies |
| [Rate Limit](/en/reference/rate-limit/) | 1.0.0 | Fixed window, sliding window, and token bucket algorithms |
| [Idempotency](/en/reference/idempotency/) | 1.0.0 | Request deduplication with fingerprinting and response replay |
| [Streams](/en/reference/streams/) | 1.0.0 | Redis Streams with consumer groups and dead letter queues |
| [Metrics](/en/reference/metrics/) | 1.0.0 | Prometheus metrics export with Grafana dashboards |
| [Tracing](/en/reference/tracing/) | 1.0.0 | OpenTelemetry distributed tracing integration |

## Resources

- [GitHub Repository](https://github.com/nestjs-redisx/nestjs-redisx) — Source code, issues, and contributions
- [GitHub Discussions](https://github.com/nestjs-redisx/nestjs-redisx/discussions) — Questions, ideas, and community support
- [npm Package](https://www.npmjs.com/package/@nestjs-redisx/core) — Installation and package details

## Sponsors

NestJS RedisX is free and open source. If it saves your team time, consider sponsoring the project.

<script setup>
import { ref, onMounted } from 'vue'
const platinum = ref([])
const gold = ref([])
const silver = ref([])
const bronze = ref([])
onMounted(async () => {
  const res = await fetch('/sponsors.json')
  const data = await res.json()
  platinum.value = data.platinum || []
  gold.value = data.gold || []
  silver.value = data.silver || []
  bronze.value = data.bronze || []
})
</script>

<div v-if="platinum.length" :class="$style.tier">
  <p :class="$style.tierLabel">Platinum Sponsors</p>
  <div :class="$style.grid">
    <a v-for="s in platinum" :key="s.name" :href="s.url" :class="[$style.logo, $style.logoPlatinum]" target="_blank" rel="noopener sponsored nofollow">
      <img :src="s.logo" :alt="s.name">
    </a>
  </div>
</div>

<div v-if="gold.length" :class="$style.tier">
  <p :class="$style.tierLabel">Gold Sponsors</p>
  <div :class="$style.grid">
    <a v-for="s in gold" :key="s.name" :href="s.url" :class="[$style.logo, $style.logoGold]" target="_blank" rel="noopener sponsored nofollow">
      <img :src="s.logo" :alt="s.name">
    </a>
  </div>
</div>

<div v-if="silver.length" :class="$style.tier">
  <p :class="$style.tierLabel">Silver Sponsors</p>
  <div :class="$style.grid">
    <a v-for="s in silver" :key="s.name" :href="s.url" :class="[$style.logo, $style.logoSilver]" target="_blank" rel="noopener sponsored nofollow">
      <img :src="s.logo" :alt="s.name">
    </a>
  </div>
</div>

<div v-if="bronze.length" :class="$style.tier">
  <p :class="$style.tierLabel">Backers</p>
  <div :class="$style.grid">
    <a v-for="s in bronze" :key="s.name" :href="s.url" :class="[$style.logo, $style.logoBronze]" target="_blank" rel="noopener sponsored nofollow">
      <img :src="s.logo" :alt="s.name">
    </a>
  </div>
</div>

<div :class="$style.cta">
  <a href="https://github.com/sponsors/sur-ser" :class="$style.ctaPrimary" target="_blank" rel="noopener">Become a Sponsor</a>
</div>

<style module>
.tier {
  margin: 2rem 0;
}
.tierLabel {
  text-align: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 1rem;
}
.grid {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(128, 128, 128, 0.03);
  border-radius: 12px;
  transition: background 0.3s;
}
.logo img {
  width: auto;
  filter: grayscale(1) opacity(0.6);
  transition: filter 0.3s;
}
.logo:hover {
  background: rgba(128, 128, 128, 0.06);
}
.logo:hover img {
  filter: grayscale(0) opacity(1);
}
.logoPlatinum {
  padding: 2rem 3rem;
}
.logoPlatinum img {
  height: 60px;
}
.logoGold {
  padding: 1.5rem 2.5rem;
}
.logoGold img {
  height: 44px;
}
.logoSilver {
  padding: 1.25rem 2rem;
}
.logoSilver img {
  height: 32px;
}
.logoBronze {
  padding: 1rem 1.5rem;
}
.logoBronze img {
  height: 24px;
}
.cta {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 2rem;
  flex-wrap: wrap;
}
.ctaPrimary {
  display: inline-block;
  background: var(--vp-c-brand-1);
  color: #fff !important;
  padding: 0.5rem 1.5rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  transition: opacity 0.25s;
}
.ctaPrimary:hover {
  opacity: 0.85;
}

</style>
