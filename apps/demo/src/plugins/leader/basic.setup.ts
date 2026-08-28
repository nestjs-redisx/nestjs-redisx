import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@nestjs-redisx/core';
import { LeaderPlugin } from '@nestjs-redisx/leader';

@Module({
  imports: [
    // @Cron fires on EVERY instance; @LeaderOnly gates the body
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new LeaderPlugin({
          ttlMs: 15_000, // leadership lease; crash failover bound
          renewIntervalMs: 5_000, // heartbeat while leader (must be < ttlMs)
          retryIntervalMs: 2_000, // acquire retry while follower
        }),
      ],
    }),
  ],
})
export class AppModule {}
