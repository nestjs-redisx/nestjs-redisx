import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        IdempotencyPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            defaultTtl: config.get('IDEMPOTENCY_TTL', 86400),
            headerName: config.get('IDEMPOTENCY_HEADER', 'Idempotency-Key'),
            lockTimeout: config.get('IDEMPOTENCY_LOCK_TIMEOUT', 30000),
            waitTimeout: config.get('IDEMPOTENCY_WAIT_TIMEOUT', 60000),
            validateFingerprint: config.get('IDEMPOTENCY_VALIDATE_FP', true),
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
