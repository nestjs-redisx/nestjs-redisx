import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
})
export class AppModule {}
