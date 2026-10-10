import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { DedupPlugin } from '@nestjs-redisx/dedup';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new DedupPlugin({
          defaultWindow: 60_000, // repeats within a minute are duplicates
          errorPolicy: 'fail-open', // store down -> run anyway (at-least-once)
        }),
      ],
    }),
  ],
})
export class AppModule {}
