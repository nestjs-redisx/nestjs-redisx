import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        // Async plugin config — reads values from ConfigService
        CachePlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            l1: { maxSize: config.get('CACHE_L1_MAX_SIZE', 1000) },
            l2: { defaultTtl: config.get('CACHE_L2_TTL', 3600) },
          }),
        }),

        // Sync plugin config — works as before
        new LocksPlugin({ defaultTtl: 30000 }),
      ],
    }),
  ],
})
export class AppModule {}
