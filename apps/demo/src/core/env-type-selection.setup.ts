import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-redisx/core';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const env = config.get('NODE_ENV');

        if (env === 'production') {
          return {
            clients: {
              type: 'cluster' as const,
              nodes: JSON.parse(config.get<string>('REDIS_CLUSTER_NODES', '[]')),
              password: config.get<string>('REDIS_PASSWORD'),
            },
          };
        }

        return {
          clients: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
