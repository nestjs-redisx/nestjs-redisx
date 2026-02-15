import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clients: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
      }),
      plugins: [
        new CachePlugin({
          l1: {
            enabled: process.env.CACHE_L1_ENABLED !== 'false',
            maxSize: parseInt(process.env.CACHE_L1_MAX_SIZE || '1000', 10),
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
