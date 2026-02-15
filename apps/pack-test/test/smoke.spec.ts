import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';

describe('Pack Smoke Test', () => {
  describe('Import verification', () => {
    it('should import all core exports', async () => {
      const core = await import('@nestjs-redisx/core');

      expect(core.RedisModule).toBeDefined();
      expect(core.RedisService).toBeDefined();
      expect(core.InjectRedis).toBeDefined();
      expect(core.REDIS_DRIVER).toBeDefined();
      expect(core.REDIS_CLIENT).toBeDefined();
      expect(core.ErrorCode).toBeDefined();
    });

    it('should import all cache exports', async () => {
      const cache = await import('@nestjs-redisx/cache');

      expect(cache.CachePlugin).toBeDefined();
      expect(cache.CacheService).toBeDefined();
      expect(cache.Cached).toBeDefined();
      expect(cache.CACHE_SERVICE).toBeDefined();
      expect(cache.CacheError).toBeDefined();
      expect(cache.KeyBuilder).toBeDefined();
    });

    it('should import all locks exports', async () => {
      const locks = await import('@nestjs-redisx/locks');

      expect(locks.LocksPlugin).toBeDefined();
      expect(locks.LockService).toBeDefined();
      expect(locks.WithLock).toBeDefined();
      expect(locks.LOCK_SERVICE).toBeDefined();
      expect(locks.LockError).toBeDefined();
    });

    it('should import all rate-limit exports', async () => {
      const rateLimit = await import('@nestjs-redisx/rate-limit');

      expect(rateLimit.RateLimitPlugin).toBeDefined();
      expect(rateLimit.RateLimitService).toBeDefined();
      expect(rateLimit.RateLimit).toBeDefined();
      expect(rateLimit.RateLimitGuard).toBeDefined();
      expect(rateLimit.RATE_LIMIT_SERVICE).toBeDefined();
      expect(rateLimit.RateLimitError).toBeDefined();
    });

    it('should import all idempotency exports', async () => {
      const idempotency = await import('@nestjs-redisx/idempotency');

      expect(idempotency.IdempotencyPlugin).toBeDefined();
      expect(idempotency.IdempotencyService).toBeDefined();
      expect(idempotency.Idempotent).toBeDefined();
      expect(idempotency.IdempotencyInterceptor).toBeDefined();
      expect(idempotency.IDEMPOTENCY_SERVICE).toBeDefined();
      expect(idempotency.IdempotencyError).toBeDefined();
    });

    it('should import all streams exports', async () => {
      const streams = await import('@nestjs-redisx/streams');

      expect(streams.StreamsPlugin).toBeDefined();
      expect(streams.StreamProducerService).toBeDefined();
      expect(streams.StreamConsumerService).toBeDefined();
      expect(streams.StreamConsumer).toBeDefined();
      expect(streams.STREAM_PRODUCER).toBeDefined();
      expect(streams.StreamError).toBeDefined();
    });

    it('should import all metrics exports', async () => {
      const metrics = await import('@nestjs-redisx/metrics');

      expect(metrics.MetricsPlugin).toBeDefined();
      expect(metrics.MetricsService).toBeDefined();
      expect(metrics.MetricsController).toBeDefined();
      expect(metrics.METRICS_SERVICE).toBeDefined();
      expect(metrics.MetricsError).toBeDefined();
    });

    it('should import all tracing exports', async () => {
      const tracing = await import('@nestjs-redisx/tracing');

      expect(tracing.TracingPlugin).toBeDefined();
      expect(tracing.TracingService).toBeDefined();
      expect(tracing.TRACING_SERVICE).toBeDefined();
      expect(tracing.TracingError).toBeDefined();
    });
  });

  describe('DI bootstrap', () => {
    it('should create a TestingModule with RedisModule and all plugins', async () => {
      const { RedisModule } = await import('@nestjs-redisx/core');
      const { CachePlugin } = await import('@nestjs-redisx/cache');
      const { LocksPlugin } = await import('@nestjs-redisx/locks');
      const { RateLimitPlugin } = await import('@nestjs-redisx/rate-limit');
      const { IdempotencyPlugin } = await import('@nestjs-redisx/idempotency');
      const { StreamsPlugin } = await import('@nestjs-redisx/streams');
      const { MetricsPlugin } = await import('@nestjs-redisx/metrics');
      const { TracingPlugin } = await import('@nestjs-redisx/tracing');

      const mockRedisClient = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
        ping: async () => 'PONG',
        quit: async () => {},
        disconnect: async () => {},
        status: 'ready',
        on: () => {},
        once: () => {},
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          RedisModule.forRoot({
            clients: {
              host: 'localhost',
              port: 6379,
            },
            plugins: [
              new CachePlugin({ l1: { maxSize: 100 } }),
              new LocksPlugin({ defaultTtl: 5000 }),
              new RateLimitPlugin({ defaultPoints: 10, defaultDuration: 60 }),
              new IdempotencyPlugin({ defaultTtl: 3600 }),
              new StreamsPlugin({}),
              new MetricsPlugin({ enabled: true }),
              new TracingPlugin({ enabled: false }),
            ],
          }),
        ],
      })
        .overrideProvider('REDIS_CLIENT')
        .useValue(mockRedisClient)
        .overrideProvider('REDIS_DRIVER')
        .useValue(mockRedisClient)
        .overrideProvider('default_REDIS_CLIENT')
        .useValue(mockRedisClient)
        .compile();

      expect(moduleRef).toBeDefined();

      await moduleRef.close();
    });
  });
});
