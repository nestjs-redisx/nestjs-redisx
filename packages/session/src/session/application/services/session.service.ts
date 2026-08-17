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
    // Ownership check: a stale index entry may point at a sid that was since
    // re-saved under another user (account switch without sid regeneration) —
    // it must never leak onto this user's device page.
    return sessions.filter((session): session is ISessionInfo<T> => session !== null && (session.metadata?.userId === undefined || session.metadata.userId === userId));
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
    return this.revokeSessions(await this.revocableIds(userId));
  }

  async revokeAllExcept(userId: string, currentSessionId: string): Promise<number> {
    const ids = await this.revocableIds(userId);
    return this.revokeSessions(ids.filter((id) => id !== currentSessionId));
  }

  recordActivity(sessionId: string, activity: ISessionActivity): Promise<void> {
    return this.store.recordActivity(sessionId, activity);
  }

  /**
   * Session IDs this user may revoke: everything in their index except entries
   * whose metadata now names a DIFFERENT owner (a sid re-saved under another
   * account must never be destroyed from here). Entries whose session is gone
   * are kept in the list on purpose — destroying them is what cleans a dirty
   * index (phantom seats).
   */
  private async revocableIds(userId: string): Promise<string[]> {
    const ids = await this.store.getUserSessionIds(userId);
    const owners = await Promise.all(ids.map((id) => this.store.getMetadata(id)));
    return ids.filter((_id, index) => {
      const owner = owners[index]?.userId;
      return owner === undefined || owner === userId;
    });
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
