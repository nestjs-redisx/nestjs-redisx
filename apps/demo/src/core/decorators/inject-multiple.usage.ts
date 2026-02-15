import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';
import { Job, Session } from '../types';

@Injectable()
export class DataService {
  constructor(
    @InjectRedis('cache')
    private readonly cache: IRedisDriver,

    @InjectRedis('queue')
    private readonly queue: IRedisDriver,

    @InjectRedis('sessions')
    private readonly sessions: IRedisDriver,
  ) {}

  async cacheData(key: string, value: string): Promise<void> {
    await this.cache.set(key, value, { ex: 3600 });
  }

  async enqueueJob(job: Job): Promise<void> {
    await this.queue.rpush('jobs', JSON.stringify(job));
  }

  async getSession(id: string): Promise<Session | null> {
    const data = await this.sessions.get(`session:${id}`);
    return data ? JSON.parse(data) : null;
  }
}
