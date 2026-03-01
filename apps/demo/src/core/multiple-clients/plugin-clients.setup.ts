import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { StreamsPlugin } from '@nestjs-redisx/streams';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        default: { host: 'localhost', port: 6379, commandTimeout: 5000 },
        streams: { host: 'localhost', port: 6379, commandTimeout: 30000 },
      },
      plugins: [
        new CachePlugin({ /* uses default client */ }),
        new LocksPlugin({ /* uses default client */ }),
        new StreamsPlugin({ client: 'streams' }),
      ],
    }),
  ],
})
export class AppModule {}
