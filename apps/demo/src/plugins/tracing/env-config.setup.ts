import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';
import { TracingPlugin } from '@nestjs-redisx/tracing';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      plugins: [
        new TracingPlugin({
          serviceName: process.env.SERVICE_NAME || 'my-service',
          exporter: {
            type: 'otlp',
            endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
            headers: {
              'x-api-key': process.env.TRACING_API_KEY || '',
            },
          },
          sampling: {
            strategy: 'ratio',
            ratio: process.env.NODE_ENV === 'production' ? 0.01 : 1.0,
          },
          resourceAttributes: {
            'deployment.environment': process.env.ENVIRONMENT || 'development',
            'service.instance.id': process.env.HOSTNAME || 'local',
          },
          enabled: process.env.TRACING_ENABLED !== 'false',
          traceRedisCommands: true,
          pluginTracing: true,
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
