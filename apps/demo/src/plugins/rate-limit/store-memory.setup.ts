import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new RateLimitPlugin({
          // Per-instance counters in process memory: zero Redis round-trip
          // on the request path. Each node enforces its own limit, so the
          // effective global limit is roughly per-node limit x node count.
          store: 'memory',
          defaultPoints: 300,
          defaultDuration: 60,
          // Memory safety: cap the number of tracked keys and sweep expired
          // entries periodically (protects against random-key spray).
          memory: {
            maxKeys: 100_000,
            sweepIntervalMs: 30_000,
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
