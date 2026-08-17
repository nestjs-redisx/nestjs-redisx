import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SessionPlugin } from '@nestjs-redisx/session';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new SessionPlugin({
          keyPrefix: 'sess:', // Redis key namespace
          defaultTtlMs: 86_400_000, // 1 day when the cookie has no maxAge
        }),
      ],
    }),
  ],
})
export class AppModule {}
