import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CircuitBreakerPlugin } from '@nestjs-redisx/circuit-breaker';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CircuitBreakerPlugin({
          failureThreshold: 5, // trip after 5 failures...
          windowMs: 10000, // ...within a 10s rolling window
          openDurationMs: 30000, // stay OPEN for 30s before probing
          halfOpenMaxCalls: 1, // allow 1 probe while HALF_OPEN
          successThreshold: 1, // 1 successful probe closes the breaker
          probeTimeoutMs: 30000, // reclaim a probe slot if its outcome is never recorded
        }),
      ],
    }),
  ],
})
export class AppModule {}
