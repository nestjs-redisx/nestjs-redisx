import { Injectable } from '@nestjs/common';
import { InjectRedis, IRedisDriver } from '@nestjs-redisx/core';
import { SessionData, generateSessionId } from '../types';

@Injectable()
export class SessionService {
  constructor(
    @InjectRedis('sessions')
    private readonly sessionStore: IRedisDriver,
  ) {}

  async createSession(userId: string, data: SessionData): Promise<string> {
    const sessionId = generateSessionId();
    await this.sessionStore.set(
      `session:${sessionId}`,
      JSON.stringify({ userId, ...data }),
      { ex: 86400 },
    );
    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const data = await this.sessionStore.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }
}
