import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import {
  CachePlugin,
  MsgpackSerializer,
  SERIALIZER,
} from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new CachePlugin()],
    }),
  ],
  providers: [
    // Override the internal serializer
    {
      provide: SERIALIZER,
      useValue: new MsgpackSerializer(),
    },
  ],
})
export class AppModule {}
