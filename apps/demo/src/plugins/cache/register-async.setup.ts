import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        CachePlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            l1: {
              enabled: config.get('CACHE_L1_ENABLED', true),
              maxSize: config.get('CACHE_L1_MAX_SIZE', 1000),
            },
            l2: {
              defaultTtl: config.get('CACHE_L2_TTL', 3600),
            },
            stampede: {
              enabled: config.get('CACHE_STAMPEDE_ENABLED', true),
            },
            swr: {
              enabled: config.get('CACHE_SWR_ENABLED', false),
              defaultStaleTime: config.get('CACHE_SWR_STALE_TIME', 60),
            },
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
