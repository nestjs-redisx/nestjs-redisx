import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CachePlugin({
          swr: { enabled: true, defaultStaleTime: 3600 }, // freshness policy: 1h
          staleIfError: {
            enabled: true,
            // Availability policy: keep serving the last known value for up
            // to 7 days while the loader keeps FAILING. Always a finite
            // number — an explicit value keeps Redis memory bounded.
            defaultWindow: 7 * 24 * 3600,
            // Which errors qualify: exclude "data is gone for good" cases so
            // a deleted resource is not served stale forever.
            shouldServe: (error) => !/404|410/.test(error.message),
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
