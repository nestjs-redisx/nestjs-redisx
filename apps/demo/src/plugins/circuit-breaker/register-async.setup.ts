import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { CircuitBreakerPlugin } from '@nestjs-redisx/circuit-breaker';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Plugins live OUTSIDE useFactory (standard NestJS pattern). Their own
      // options can still be loaded asynchronously via registerAsync.
      plugins: [
        CircuitBreakerPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            failureThreshold: config.get<number>('CB_FAILURE_THRESHOLD', 5),
            openDurationMs: config.get<number>('CB_OPEN_MS', 30000),
          }),
        }),
      ],
      useFactory: (config: ConfigService) => ({
        clients: {
          type: 'single',
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
})
export class AppModule {}
