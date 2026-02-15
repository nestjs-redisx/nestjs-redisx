import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        default: {
          host: 'localhost',
          port: 6379,
          db: 0,
        },
        cache: {
          host: 'cache-server',
          port: 6379,
          db: 1,
        },
        sessions: {
          host: 'session-server',
          port: 6379,
          db: 2,
        },
        queue: {
          host: 'queue-server',
          port: 6379,
          db: 3,
        },
      },
    }),
  ],
})
export class AppModule {}
