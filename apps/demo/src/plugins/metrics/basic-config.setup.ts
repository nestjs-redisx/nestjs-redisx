import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin } from '@nestjs-redisx/metrics';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new MetricsPlugin({
          prefix: 'redisx_',
          endpoint: '/metrics',
          defaultLabels: {
            service: 'my-service',
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
