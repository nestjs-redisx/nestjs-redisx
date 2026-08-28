import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { LeaderPlugin } from '@nestjs-redisx/leader';
import { alertOps } from './types';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new LeaderPlugin({
          // Extra elections started at bootstrap (besides 'default' and
          // the groups referenced by @LeaderOnly decorators)
          groups: ['reports', 'cleanup'],

          // Fire-and-forget lifecycle callbacks: errors are logged and
          // never break the election loop.
          onElected: (group) => {
            console.log(`This instance now leads "${group}"`);
          },
          onLost: (group, reason) => {
            // reason: 'expired' | 'stepdown' | 'shutdown'
            if (reason === 'expired') {
              alertOps(`Unexpectedly lost leadership of "${group}"`);
            }
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
