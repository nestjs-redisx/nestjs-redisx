import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { SessionPlugin } from '@nestjs-redisx/session';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      plugins: [
        SessionPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            maxSessionsPerUser: config.get<number>('MAX_SESSIONS_PER_USER', 5),
            absoluteLifetimeMs: config.get<number>('SESSION_ABSOLUTE_LIFETIME_MS', 12 * 3600 * 1000),
          }),
        }),
      ],
      useFactory: (config: ConfigService) => ({
        clients: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
})
export class AppModule {}
