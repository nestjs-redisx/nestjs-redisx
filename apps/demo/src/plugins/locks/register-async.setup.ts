import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        LocksPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            defaultTtl: config.get('LOCK_DEFAULT_TTL', 30000),
            maxTtl: config.get('LOCK_MAX_TTL', 300000),
            retry: {
              maxRetries: config.get('LOCK_MAX_RETRIES', 3),
              initialDelay: config.get('LOCK_RETRY_DELAY', 100),
            },
            autoRenew: {
              enabled: config.get('LOCK_AUTO_RENEW', true),
            },
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
