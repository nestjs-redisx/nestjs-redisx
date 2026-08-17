import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SessionPlugin } from '@nestjs-redisx/session';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new SessionPlugin({
          // Seat limit: at most 3 concurrent sessions per user.
          // 'evict-oldest' silently signs out the oldest device;
          // 'reject' throws SessionLimitExceededError at login instead.
          maxSessionsPerUser: 3,
          maxSessionsPolicy: 'evict-oldest',

          // Compliance cap (PCI DSS / OWASP): force re-login every 12 hours
          // regardless of activity. Idle timeout stays the middleware's job;
          // this cap is what express-session alone cannot enforce.
          absoluteLifetimeMs: 12 * 3600 * 1000,
        }),
      ],
    }),
  ],
})
export class AppModule {}
