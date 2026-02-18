import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { TracingPlugin } from '@nestjs-redisx/tracing';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        TracingPlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            enabled: config.get('TRACING_ENABLED', true),
            serviceName: config.get('SERVICE_NAME', 'my-service'),
            exporter: {
              type: 'otlp' as const,
              endpoint: config.get('OTLP_ENDPOINT', 'http://localhost:4318'),
            },
            sampling: {
              strategy: 'ratio' as const,
              ratio: config.get('TRACING_SAMPLE_RATIO', 1.0),
            },
            resourceAttributes: {
              'deployment.environment': config.get('ENVIRONMENT', 'development'),
            },
          }),
        }),
      ],
    }),
  ],
})
export class AppModule {}
