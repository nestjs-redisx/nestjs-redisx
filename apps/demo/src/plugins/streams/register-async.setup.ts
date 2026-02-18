import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin } from '@nestjs-redisx/streams';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        StreamsPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            consumer: {
              batchSize: config.get('STREAMS_BATCH_SIZE', 10),
              concurrency: config.get('STREAMS_CONCURRENCY', 1),
              maxRetries: config.get('STREAMS_MAX_RETRIES', 3),
            },
            dlq: {
              enabled: config.get('STREAMS_DLQ_ENABLED', true),
            },
            producer: {
              maxLen: config.get('STREAMS_MAX_LEN', 100000),
            },
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
