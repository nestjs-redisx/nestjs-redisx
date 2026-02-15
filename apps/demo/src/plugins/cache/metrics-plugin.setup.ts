import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { MetricsPlugin } from '@nestjs-redisx/metrics';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CachePlugin({ l1: { maxSize: 1000 } }),
        new MetricsPlugin(),  // Enables automatic metric collection
      ],
    }),
  ],
})
export class AppModule {}
