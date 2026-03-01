import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin } from '@nestjs-redisx/streams';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      plugins: [
        new StreamsPlugin({
          client: process.env.STREAMS_CLIENT || 'default',
          consumer: {
            batchSize: parseInt(process.env.STREAMS_BATCH_SIZE || '10', 10),
            concurrency: parseInt(process.env.STREAMS_CONCURRENCY || '1', 10),
            maxRetries: parseInt(process.env.STREAMS_MAX_RETRIES || '3', 10),
          },
          dlq: {
            enabled: process.env.STREAMS_DLQ_ENABLED !== 'false',
          },
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
