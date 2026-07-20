import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CircuitBreakerPlugin } from '@nestjs-redisx/circuit-breaker';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CircuitBreakerPlugin({
          // errorPolicy governs what happens when the STATE STORE (Redis) is
          // unavailable — not when the breaker itself is OPEN.
          //
          // 'fail-open'  -> run the guarded call anyway (favor availability)
          // 'fail-closed' (default) -> throw CircuitBreakerStoreError
          errorPolicy: 'fail-open',
        }),
      ],
    }),
  ],
})
export class AppModule {}
