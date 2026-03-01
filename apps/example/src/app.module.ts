/**
 * @fileoverview Main application module.
 *
 * Uses the @nestjs-redisx plugin architecture.
 * All plugins are registered via RedisModule.forRoot({ plugins: [...] }).
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

// @nestjs-redisx core
import { RedisModule } from '@nestjs-redisx/core';

// Plugins (implement IRedisXPlugin)
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';
import { StreamsPlugin } from '@nestjs-redisx/streams';
import { MetricsPlugin } from '@nestjs-redisx/metrics';
import { TracingPlugin } from '@nestjs-redisx/tracing';

// Configuration
import { redisConfig } from './config/redis.config';
import { cacheConfig } from './config/cache.config';
import { locksConfig } from './config/locks.config';
import { rateLimitConfig } from './config/rate-limit.config';
import { idempotencyConfig } from './config/idempotency.config';
import { streamsConfig } from './config/streams.config';
import { metricsConfig } from './config/metrics.config';
import { tracingConfig } from './config/tracing.config';

// Demo modules
import { CoreDemoModule } from './demo/core/core-demo.module';
import { CacheDemoModule } from './demo/cache/cache-demo.module';
import { LocksDemoModule } from './demo/locks/locks-demo.module';
import { RateLimitDemoModule } from './demo/rate-limit/rate-limit-demo.module';
import { IdempotencyDemoModule } from './demo/idempotency/idempotency-demo.module';
import { StreamsDemoModule } from './demo/streams/streams-demo.module';
import { MetricsDemoModule } from './demo/metrics/metrics-demo.module';
import { TracingDemoModule } from './demo/tracing/tracing-demo.module';
import { IntegrationDemoModule } from './demo/integration/integration-demo.module';

@Module({
  imports: [
    // ConfigModule - loads .env files
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // All plugins are registered via RedisModule.forRootAsync()
    // Plugins are passed OUTSIDE useFactory (standard NestJS pattern)
    // useFactory is only used for dynamic connection config loading via ConfigService
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Plugins OUTSIDE useFactory - they must be available statically
      // Plugin configuration is loaded from process.env (statically)
      plugins: [
        // MetricsPlugin — Prometheus metrics (FIRST for integration with other plugins)
        new MetricsPlugin({
          enabled: true,
          exposeEndpoint: true,
        }),

        // TracingPlugin — OpenTelemetry distributed tracing
        new TracingPlugin({
          enabled: true,
        }),

        // CachePlugin — L1+L2 caching, SWR, tag invalidation (async via ConfigService)
        CachePlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            l1: {
              enabled: true,
              maxSize: config.get<number>('CACHE_L1_MAX_SIZE', 1000),
              ttl: config.get<number>('CACHE_L1_TTL', 60),
            },
            l2: {
              enabled: true,
              defaultTtl: config.get<number>('CACHE_L2_TTL', 3600),
            },
            stampede: { enabled: true },
            swr: { enabled: false },
            tags: { enabled: true },
          }),
        }),

        // LocksPlugin — distributed locks with auto-renewal
        new LocksPlugin({
          defaultTtl: parseInt(process.env.LOCK_DEFAULT_TTL || '30000', 10),
          autoRenew: { enabled: process.env.LOCK_AUTO_RENEW !== 'false' },
        }),

        // RateLimitPlugin — request rate limiting (fixed/sliding/token-bucket)
        new RateLimitPlugin({
          defaultPoints: parseInt(process.env.RATE_LIMIT_POINTS || '100', 10),
          defaultDuration: parseInt(
            process.env.RATE_LIMIT_DURATION || '60',
            10,
          ),
        }),

        // IdempotencyPlugin — request deduplication with replay
        new IdempotencyPlugin({
          defaultTtl: 3600000,
        }),

        // StreamsPlugin — Redis Streams with consumer groups and DLQ
        // Uses dedicated 'streams' client to avoid blocking the shared connection
        new StreamsPlugin({
          client: 'streams',
          consumer: { batchSize: 10 },
        }),
      ],
      // useFactory ONLY for connection config loaded via ConfigService
      useFactory: (configService: ConfigService) => redisConfig(configService),
    }),

    CoreDemoModule,
    CacheDemoModule,
    LocksDemoModule,
    RateLimitDemoModule,
    IdempotencyDemoModule,
    StreamsDemoModule,
    MetricsDemoModule,
    TracingDemoModule,
    IntegrationDemoModule,
  ],
})
export class AppModule {}
