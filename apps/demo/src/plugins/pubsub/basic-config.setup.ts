import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { PubSubPlugin } from '@nestjs-redisx/pubsub';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new PubSubPlugin({
          channelPrefix: 'app:', // optional namespace for all channels
        }),
      ],
    }),
  ],
})
export class AppModule {}
