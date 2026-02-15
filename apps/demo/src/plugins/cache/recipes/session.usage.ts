import { Injectable } from '@nestjs/common';
import { Cached, InvalidateTags } from '@nestjs-redisx/cache';
import { Session, SessionRepository } from '../types';

@Injectable()
export class SessionService {
  constructor(private readonly repository: SessionRepository) {}

  @Cached({
    key: 'session:{0}',
    ttl: 1800,
    tags: (sessionId: string) => [`session:${sessionId}`, 'sessions'],
  })
  async getSession(sessionId: string): Promise<Session> {
    return this.repository.findOne(sessionId);
  }

  @InvalidateTags({
    tags: (sessionId: string) => [`session:${sessionId}`],
  })
  async destroySession(sessionId: string): Promise<void> {
    await this.repository.delete(sessionId);
  }
}
