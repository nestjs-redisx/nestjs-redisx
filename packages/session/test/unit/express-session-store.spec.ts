import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';
import { Store } from 'express-session';

import { toExpressStore } from '../../src/session/api/stores/express-session-store';
import type { ISessionStore } from '../../src/session/application/ports/session-store.port';

const NOW = 1_700_000_000_000;

function createStoreMock(): MockedObject<ISessionStore> {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(true),
    destroy: vi.fn().mockResolvedValue(true),
    getMetadata: vi.fn(),
    recordActivity: vi.fn(),
    getUserSessionIds: vi.fn(),
    count: vi.fn(),
    countByUser: vi.fn(),
  } as unknown as MockedObject<ISessionStore>;
}

describe('toExpressStore', () => {
  let store: MockedObject<ISessionStore>;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    store = createStoreMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should produce an express-session Store instance', async () => {
    // When
    const expressStore = await toExpressStore(store);

    // Then
    expect(expressStore).toBeInstanceOf(Store);
  });

  describe('get', () => {
    it('should deliver the session to the callback', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      store.get.mockResolvedValue({ cookie: {}, user: 'u1' });

      // When
      const result = await new Promise((resolve, reject) => {
        expressStore.get('sid-1', (err, session) => (err ? reject(err) : resolve(session)));
      });

      // Then
      expect(result).toEqual({ cookie: {}, user: 'u1' });
      expect(store.get).toHaveBeenCalledWith('sid-1');
    });

    it('should deliver null for a missing session', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      store.get.mockResolvedValue(null);

      // When
      const result = await new Promise((resolve, reject) => {
        expressStore.get('gone', (err, session) => (err ? reject(err) : resolve(session)));
      });

      // Then
      expect(result).toBeNull();
    });

    it('should propagate store errors to the callback', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const failure = new Error('down');
      store.get.mockRejectedValue(failure);

      // When
      const err = await new Promise((resolve) => {
        expressStore.get('sid-1', (e) => resolve(e));
      });

      // Then
      expect(err).toBe(failure);
    });
  });

  describe('set', () => {
    it('should derive the TTL from cookie.expires', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const session = { cookie: { expires: new Date(NOW + 30_000) } };

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.set('sid-1', session as never, (err) => (err ? reject(err) : resolve()));
      });

      // Then
      expect(store.set).toHaveBeenCalledWith('sid-1', session, { ttlMs: 30_000 });
    });

    it('should fall back to the configured ttlMs when the cookie has no expiry', async () => {
      // Given
      const expressStore = await toExpressStore(store, { ttlMs: 5_000 });
      const session = { cookie: {} };

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.set('sid-1', session as never, (err) => (err ? reject(err) : resolve()));
      });

      // Then
      expect(store.set).toHaveBeenCalledWith('sid-1', session, { ttlMs: 5_000 });
    });

    it('should let the store default apply when neither cookie expiry nor ttlMs is set', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const session = { cookie: {} };

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.set('sid-1', session as never, (err) => (err ? reject(err) : resolve()));
      });

      // Then
      expect(store.set).toHaveBeenCalledWith('sid-1', session, { ttlMs: undefined });
    });

    it('should destroy the session instead of writing one that already expired', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const session = { cookie: { expires: new Date(NOW - 1000) } };

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.set('sid-1', session as never, (err) => (err ? reject(err) : resolve()));
      });

      // Then
      expect(store.set).not.toHaveBeenCalled();
      expect(store.destroy).toHaveBeenCalledWith('sid-1');
    });

    it('should propagate rejection errors (seat limit) to the callback', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const failure = new Error('limit');
      store.set.mockRejectedValue(failure);

      // When
      const err = await new Promise((resolve) => {
        expressStore.set('sid-1', { cookie: {} } as never, (e) => resolve(e));
      });

      // Then
      expect(err).toBe(failure);
    });
  });

  describe('touch', () => {
    it('should slide the TTL derived from cookie.expires', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const session = { cookie: { expires: new Date(NOW + 10_000) } };

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.touch('sid-1', session as never, (err?: unknown) => (err ? reject(err as Error) : resolve()));
      });

      // Then
      expect(store.touch).toHaveBeenCalledWith('sid-1', { ttlMs: 10_000 });
    });

    it('should propagate touch errors to the callback', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const failure = new Error('down');
      store.touch.mockRejectedValue(failure);

      // When
      const err = await new Promise((resolve) => {
        expressStore.touch('sid-1', { cookie: {} } as never, (e?: unknown) => resolve(e));
      });

      // Then
      expect(err).toBe(failure);
    });
  });

  describe('destroy', () => {
    it('should destroy the session', async () => {
      // Given
      const expressStore = await toExpressStore(store);

      // When
      await new Promise<void>((resolve, reject) => {
        expressStore.destroy('sid-1', (err) => (err ? reject(err) : resolve()));
      });

      // Then
      expect(store.destroy).toHaveBeenCalledWith('sid-1');
    });

    it('should propagate destroy errors to the callback', async () => {
      // Given
      const expressStore = await toExpressStore(store);
      const failure = new Error('down');
      store.destroy.mockRejectedValue(failure);

      // When
      const err = await new Promise((resolve) => {
        expressStore.destroy('sid-1', (e) => resolve(e));
      });

      // Then
      expect(err).toBe(failure);
    });
  });
});
