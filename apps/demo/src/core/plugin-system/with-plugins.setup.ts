import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CachePlugin({ l2: { defaultTtl: 3600 } }),
        new LocksPlugin({ defaultTtl: 30000 }),
      ],
    }),
  ],
})
export class AppModule {}
