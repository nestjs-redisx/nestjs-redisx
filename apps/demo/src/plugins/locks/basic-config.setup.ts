import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new LocksPlugin({
          defaultTtl: 30000,
          keyPrefix: '_lock:',
          autoRenew: {
            enabled: true,
            intervalFraction: 0.5,
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
