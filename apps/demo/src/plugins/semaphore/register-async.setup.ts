import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { SemaphorePlugin } from '@nestjs-redisx/semaphore';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        SemaphorePlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            defaultTtl: config.get<number>('SEMAPHORE_TTL_MS') ?? 30_000,
            keyPrefix: config.get<string>('SEMAPHORE_PREFIX') ?? '_sem:',
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
