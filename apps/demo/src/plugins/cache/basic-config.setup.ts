import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CachePlugin({
          l1: {
            enabled: true,
            maxSize: 1000,
            ttl: 60,             // seconds
          },
          l2: {
            enabled: true,
            defaultTtl: 3600,    // seconds
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
