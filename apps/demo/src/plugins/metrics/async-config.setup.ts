import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin } from '@nestjs-redisx/metrics';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      plugins: [
        new MetricsPlugin({
          enabled: process.env.METRICS_ENABLED !== 'false',
          prefix: process.env.METRICS_PREFIX || 'redisx_',
          defaultLabels: {
            app: process.env.APP_NAME,
            env: process.env.NODE_ENV,
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
