import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';

import { SessionService } from '../../src/session/application/services/session.service';
import type { ISessionStore } from '../../src/session/application/ports/session-store.port';
import type { ISessionMetadata } from '../../src/shared/types';

function metadata(overrides: Partial<ISessionMetadata> = {}): ISessionMetadata {
  return { userId: 'user-1', createdAt: 1000, lastSeenAt: 2000, expiresAt: 90_000, ...overrides };
}

describe('SessionService', () => {
  let service: SessionService;
  let store: MockedObject<ISessionStore>;

  beforeEach(() => {
    store = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(true),
      destroy: vi.fn().mockResolvedValue(true),
      getMetadata: vi.fn().mockResolvedValue(null),
      recordActivity: vi.fn().mockResolvedValue(undefined),
      getUserSessionIds: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      countByUser: vi.fn().mockResolvedValue(0),
    } as unknown as MockedObject<ISessionStore>;

    service = new SessionService(store);
  });

  describe('getSession', () => {
    it('should combine payload and metadata into session info', async () => {
      // Given
      store.get.mockResolvedValue({ cookie: {}, cart: [1] });
      store.getMetadata.mockResolvedValue(metadata());

      // When
      const info = await service.getSession('sid-1');

      // Then
      expect(info).toEqual({ id: 'sid-1', data: { cookie: {}, cart: [1] }, metadata: metadata() });
    });

    it('should return null when the session does not exist', async () => {
      // Given
      store.get.mockResolvedValue(null);

      // When / Then
      expect(await service.getSession('gone')).toBeNull();
      expect(store.getMetadata).not.toHaveBeenCalled();
    });

    it('should return null metadata when only the payload exists', async () => {
      // Given
      store.get.mockResolvedValue({ cookie: {} });
      store.getMetadata.mockResolvedValue(null);

      // When
      const info = await service.getSession('sid-1');

      // Then
      expect(info).toEqual({ id: 'sid-1', data: { cookie: {} }, metadata: null });
    });
  });

  describe('getSessionsByUser', () => {
    it('should resolve every live session for the user', async () => {
      // Given
      store.getUserSessionIds.mockResolvedValue(['sid-1', 'sid-2']);
      store.get.mockImplementation(async (sid: string) => ({ cookie: {}, sid }));
      store.getMetadata.mockImplementation(async (sid: string) => metadata({ ip: sid === 'sid-1' ? '10.0.0.1' : '10.0.0.2' }));

      // When
      const sessions = await service.getSessionsByUser('user-1');

      // Then
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.id).toBe('sid-1');
      expect(sessions[0]?.metadata?.ip).toBe('10.0.0.1');
      expect(sessions[1]?.id).toBe('sid-2');
    });

    it('should skip sessions that vanished between listing and reading', async () => {
      // Given
      store.getUserSessionIds.mockResolvedValue(['sid-1', 'sid-2']);
      store.get.mockImplementation(async (sid: string) => (sid === 'sid-1' ? { cookie: {} } : null));
      store.getMetadata.mockResolvedValue(metadata());

      // When
      const sessions = await service.getSessionsByUser('user-1');

      // Then
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe('sid-1');
    });

    it('should never expose a session that now belongs to another user', async () => {
      // Given: stale index entry after an account switch on the same sid —
      // listing it would leak the NEW owner's payload on the old owner's
      // device page
      store.getUserSessionIds.mockResolvedValue(['sid-mine', 'sid-switched']);
      store.get.mockImplementation(async () => ({ cookie: {}, secret: 'data' }));
      store.getMetadata.mockImplementation(async (sid: string) => metadata({ userId: sid === 'sid-switched' ? 'someone-else' : 'user-1' }));

      // When
      const sessions = await service.getSessionsByUser('user-1');

      // Then
      expect(sessions.map((s) => s.id)).toEqual(['sid-mine']);
    });
  });

  describe('revocation', () => {
    it('should revoke a single session with the revoked reason', async () => {
      // Given
      store.destroy.mockResolvedValue(true);

      // When
      const revoked = await service.revoke('sid-1');

      // Then
      expect(revoked).toBe(true);
      expect(store.destroy).toHaveBeenCalledWith('sid-1', 'revoked');
    });

    it('should revoke all sessions of a user and report the count', async () => {
      // Given
      store.getUserSessionIds.mockResolvedValue(['sid-1', 'sid-2', 'sid-3']);
      store.get.mockImplementation(async () => ({ cookie: {} }));
      store.getMetadata.mockResolvedValue(metadata());
      store.destroy.mockImplementation(async (sid: string) => sid !== 'sid-2');

      // When
      const count = await service.revokeAll('user-1');

      // Then
      expect(count).toBe(2);
      expect(store.destroy).toHaveBeenCalledTimes(3);
      expect(store.destroy).toHaveBeenCalledWith('sid-1', 'revoked');
    });

    it('should revoke all sessions except the current one', async () => {
      // Given
      store.getUserSessionIds.mockResolvedValue(['sid-1', 'sid-2', 'sid-current']);
      store.get.mockImplementation(async () => ({ cookie: {} }));
      store.getMetadata.mockResolvedValue(metadata());
      store.destroy.mockResolvedValue(true);

      // When
      const count = await service.revokeAllExcept('user-1', 'sid-current');

      // Then
      expect(count).toBe(2);
      expect(store.destroy).not.toHaveBeenCalledWith('sid-current', expect.anything());
    });

    it('should still destroy phantom index entries whose session is gone', async () => {
      // Given: the index lists a sid whose payload was evicted — revocation is
      // the repair path for a dirty index, so it must not skip it
      store.getUserSessionIds.mockResolvedValue(['sid-live', 'sid-phantom']);
      store.get.mockImplementation(async (sid: string) => (sid === 'sid-live' ? { cookie: {} } : null));
      store.getMetadata.mockImplementation(async (sid: string) => (sid === 'sid-phantom' ? null : metadata()));
      store.destroy.mockImplementation(async (sid: string) => sid === 'sid-live');

      // When
      const count = await service.revokeAll('user-1');

      // Then: both are attempted; only the live one counts as revoked
      expect(store.destroy).toHaveBeenCalledWith('sid-live', 'revoked');
      expect(store.destroy).toHaveBeenCalledWith('sid-phantom', 'revoked');
      expect(count).toBe(1);
    });

    it('should never revoke a session that now belongs to another user', async () => {
      // Given: a stale index entry points at a sid that was re-saved under a
      // different user (account switch) — the victim's revokeAll must not kill
      // the new owner's session
      store.getUserSessionIds.mockResolvedValue(['sid-mine', 'sid-switched']);
      store.get.mockImplementation(async () => ({ cookie: {} }));
      store.getMetadata.mockImplementation(async (sid: string) => metadata({ userId: sid === 'sid-switched' ? 'someone-else' : 'user-1' }));
      store.destroy.mockResolvedValue(true);

      // When
      const count = await service.revokeAll('user-1');

      // Then
      expect(count).toBe(1);
      expect(store.destroy).toHaveBeenCalledWith('sid-mine', 'revoked');
      expect(store.destroy).not.toHaveBeenCalledWith('sid-switched', expect.anything());
    });
  });

  describe('pass-throughs', () => {
    it('should delegate count, countByUser, and recordActivity to the store', async () => {
      // Given
      store.count.mockResolvedValue(7);
      store.countByUser.mockResolvedValue(3);

      // When / Then
      expect(await service.count()).toBe(7);
      expect(await service.countByUser('user-1')).toBe(3);

      await service.recordActivity('sid-1', { ip: '10.0.0.1' });
      expect(store.recordActivity).toHaveBeenCalledWith('sid-1', { ip: '10.0.0.1' });
    });
  });
});
