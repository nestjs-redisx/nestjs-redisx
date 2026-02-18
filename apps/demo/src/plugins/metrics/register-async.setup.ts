import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin } from '@nestjs-redisx/metrics';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        MetricsPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            enabled: config.get('METRICS_ENABLED', true),
            prefix: config.get('METRICS_PREFIX', 'redisx_'),
            exposeEndpoint: config.get('METRICS_EXPOSE_ENDPOINT', true),
            defaultLabels: {
              app: config.get('APP_NAME', 'myapp'),
              env: config.get('NODE_ENV', 'development'),
            },
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
