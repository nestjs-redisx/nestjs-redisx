import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SessionPlugin } from '@nestjs-redisx/session';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new SessionPlugin({
          // Audit hooks: fire-and-forget, failures are logged and never break
          // the request. Ship them to your audit log / SIEM.
          events: {
            onCreated: ({ sessionId, userId }) => console.log('session created', sessionId, userId),
            onDestroyed: ({ sessionId, userId }) => console.log('logout', sessionId, userId),
            onRevoked: ({ sessionId, userId }) => console.log('revoked/evicted', sessionId, userId),
            onExpiredByCap: ({ sessionId, userId }) => console.log('lifetime cap hit', sessionId, userId),
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
