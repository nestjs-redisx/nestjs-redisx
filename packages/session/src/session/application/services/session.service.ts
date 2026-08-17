import { Injectable, Inject } from '@nestjs/common';

import { SESSION_STORE } from '../../../shared/constants';
import { ISessionActivity, ISessionInfo } from '../../../shared/types';
import { ISessionService } from '../ports/session-service.port';
import { ISessionStore } from '../ports/session-store.port';

/**
 * Session service: introspection ("device page"), revocation
 * ("log out everywhere"), counting, and activity stamping — built on the
 * promise-based session store, over the SAME keys the middleware uses.
 */
@Injectable()
export class SessionService<T = unknown> implements ISessionService<T> {
  constructor(@Inject(SESSION_STORE) private readonly store: ISessionStore) {}

  async getSession(sessionId: string): Promise<ISessionInfo<T> | null> {
    const data = await this.store.get(sessionId);
    if (data === null) {
      return null;
    }
    const metadata = await this.store.getMetadata(sessionId);
    return { id: sessionId, data: data as T, metadata };
  }

  async getSessionsByUser(userId: string): Promise<Array<ISessionInfo<T>>> {
    const ids = await this.store.getUserSessionIds(userId);
    const sessions = await Promise.all(ids.map((id) => this.getSession(id)));
    return sessions.filter((session): session is ISessionInfo<T> => session !== null);
  }

  count(): Promise<number> {
    return this.store.count();
  }

  countByUser(userId: string): Promise<number> {
    return this.store.countByUser(userId);
  }

  revoke(sessionId: string): Promise<boolean> {
    return this.store.destroy(sessionId, 'revoked');
  }

  async revokeAll(userId: string): Promise<number> {
    return this.revokeSessions(await this.store.getUserSessionIds(userId));
  }

  async revokeAllExcept(userId: string, currentSessionId: string): Promise<number> {
    const ids = (await this.store.getUserSessionIds(userId)).filter((id) => id !== currentSessionId);
    return this.revokeSessions(ids);
  }

  recordActivity(sessionId: string, activity: ISessionActivity): Promise<void> {
    return this.store.recordActivity(sessionId, activity);
  }

  private async revokeSessions(sessionIds: string[]): Promise<number> {
    let revoked = 0;
    for (const id of sessionIds) {
      if (await this.store.destroy(id, 'revoked')) {
        revoked += 1;
      }
    }
    return revoked;
  }
}
