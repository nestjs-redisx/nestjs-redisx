import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';

import { toFastifyStore } from '../../src/session/api/stores/fastify-session-store';
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

describe('toFastifyStore', () => {
  let store: MockedObject<ISessionStore>;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    store = createStoreMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should deliver sessions through the get callback', async () => {
    // Given
    const fastifyStore = toFastifyStore(store);
    store.get.mockResolvedValue({ cookie: {}, user: 'u1' });

    // When
    const result = await new Promise((resolve, reject) => {
      fastifyStore.get('sid-1', (err, session) => (err ? reject(err) : resolve(session)));
    });

    // Then
    expect(result).toEqual({ cookie: {}, user: 'u1' });
  });

  it('should deliver null for a missing session', async () => {
    // Given
    const fastifyStore = toFastifyStore(store);

    // When
    const result = await new Promise((resolve, reject) => {
      fastifyStore.get('gone', (err, session) => (err ? reject(err) : resolve(session)));
    });

    // Then
    expect(result).toBeNull();
  });

  it('should write sessions with a TTL derived from cookie.expires', async () => {
    // Given
    const fastifyStore = toFastifyStore(store);
    const session = { cookie: { expires: new Date(NOW + 30_000) } };

    // When
    await new Promise<void>((resolve, reject) => {
      fastifyStore.set('sid-1', session as never, (err?: unknown) => (err ? reject(err as Error) : resolve()));
    });

    // Then
    expect(store.set).toHaveBeenCalledWith('sid-1', session, { ttlMs: 30_000 });
  });

  it('should fall back to the configured ttlMs', async () => {
    // Given
    const fastifyStore = toFastifyStore(store, { ttlMs: 5_000 });
    const session = { cookie: {} };

    // When
    await new Promise<void>((resolve, reject) => {
      fastifyStore.set('sid-1', session as never, (err?: unknown) => (err ? reject(err as Error) : resolve()));
    });

    // Then
    expect(store.set).toHaveBeenCalledWith('sid-1', session, { ttlMs: 5_000 });
  });

  it('should propagate set errors to the callback', async () => {
    // Given
    const fastifyStore = toFastifyStore(store);
    const failure = new Error('limit');
    store.set.mockRejectedValue(failure);

    // When
    const err = await new Promise((resolve) => {
      fastifyStore.set('sid-1', { cookie: {} } as never, (e?: unknown) => resolve(e));
    });

    // Then
    expect(err).toBe(failure);
  });

  it('should destroy sessions and propagate errors', async () => {
    // Given
    const fastifyStore = toFastifyStore(store);

    // When
    await new Promise<void>((resolve, reject) => {
      fastifyStore.destroy('sid-1', (err?: unknown) => (err ? reject(err as Error) : resolve()));
    });

    // Then
    expect(store.destroy).toHaveBeenCalledWith('sid-1');

    // Given a failing destroy
    const failure = new Error('down');
    store.destroy.mockRejectedValue(failure);

    // When / Then
    const err = await new Promise((resolve) => {
      fastifyStore.destroy('sid-1', (e?: unknown) => resolve(e));
    });
    expect(err).toBe(failure);
  });
});
