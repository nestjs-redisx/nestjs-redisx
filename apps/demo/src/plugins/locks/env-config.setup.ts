import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin } from '@nestjs-redisx/locks';

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
        new LocksPlugin({
          defaultTtl: parseInt(process.env.LOCK_DEFAULT_TTL || '30000', 10),
          retry: {
            maxRetries: parseInt(process.env.LOCK_MAX_RETRIES || '3', 10),
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
