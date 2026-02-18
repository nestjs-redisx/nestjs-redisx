import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        RateLimitPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            defaultAlgorithm: config.get('RATE_LIMIT_ALGORITHM', 'sliding-window'),
            defaultPoints: config.get('RATE_LIMIT_POINTS', 100),
            defaultDuration: config.get('RATE_LIMIT_DURATION', 60),
            errorPolicy: config.get('RATE_LIMIT_FAIL_OPEN') === 'true'
              ? 'fail-open' as const
              : 'fail-closed' as const,
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
