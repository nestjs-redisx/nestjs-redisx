/**
 * @fileoverview Cache plugin configuration.
 *
 * Configures two-level caching:
 * - L1: In-memory LRU cache (fast, local)
 * - L2: Redis (slower, distributed)
 */

import { ConfigService } from '@nestjs/config';
import { ICachePluginOptions } from '@nestjs-redisx/cache';

export const cacheConfig = (config: ConfigService): ICachePluginOptions => ({
  // L1 Cache (In-Memory)
  l1: {
    enabled: true,
    maxSize: 1000, // Max 1000 entries
    ttl: 60, // TTL: 60 seconds
    evictionPolicy: 'lru', // Least Recently Used
  },

  // L2 Cache (Redis)
  l2: {
    enabled: true,
    keyPrefix: 'cache:',
    defaultTtl: 3600, // TTL: 1 hour
  },

  // Stampede Protection
  stampede: {
    enabled: true,
    lockTimeout: 10000, // Lock timeout: 10 seconds
  },

  // Stale-While-Revalidate
  swr: {
    enabled: true,
    defaultStaleTime: 60, // Data goes stale after 60 sec
  },
});
