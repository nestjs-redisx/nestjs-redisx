import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clients: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
      plugins: [
        new RateLimitPlugin({
          defaultAlgorithm:
            (process.env.RATE_LIMIT_ALGORITHM as 'sliding-window' | 'fixed-window' | 'token-bucket') ||
            'sliding-window',
          defaultPoints: parseInt(process.env.RATE_LIMIT_POINTS || '100', 10),
          defaultDuration: parseInt(process.env.RATE_LIMIT_DURATION || '60', 10),
          errorPolicy: process.env.RATE_LIMIT_FAIL_OPEN === 'true' ? 'fail-open' : 'fail-closed',
        }),
      ],
    }),
  ],
})
export class AppModule {}
