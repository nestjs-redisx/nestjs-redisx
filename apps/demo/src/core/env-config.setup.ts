import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService, registerAs } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';

// config/redis.config.ts
export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  tls: process.env.REDIS_TLS === 'true' ? {
    enabled: true,
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
  } : undefined,
}));

// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [redisConfig],
    }),
    RedisModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        clients: config.get('redis'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
