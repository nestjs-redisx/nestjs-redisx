import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';
import { User, SessionData, Job, generateSessionId } from '../types';

@Injectable()
export class UserService {
  constructor(private readonly redis: RedisService) {}

  async cacheUser(user: User): Promise<void> {
    const cache = await this.redis.getClient('cache');
    await cache.set(`user:${user.id}`, JSON.stringify(user), { ex: 3600 });
  }

  async createSession(userId: string, data: SessionData): Promise<string> {
    const sessions = await this.redis.getClient('sessions');
    const sessionId = generateSessionId();
    await sessions.set(
      `session:${sessionId}`,
      JSON.stringify({ userId, ...data }),
      { ex: 86400 },
    );
    return sessionId;
  }

  async queueJob(job: Job): Promise<void> {
    const queue = await this.redis.getClient('queue');
    await queue.rpush('jobs', JSON.stringify(job));
  }
}
