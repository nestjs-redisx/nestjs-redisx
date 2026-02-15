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
          defaultAlgorithm: 'sliding-window',
          defaultPoints: 100,
          defaultDuration: 60,
          includeHeaders: true,
        }),
      ],
    }),
  ],
})
export class AppModule {}
