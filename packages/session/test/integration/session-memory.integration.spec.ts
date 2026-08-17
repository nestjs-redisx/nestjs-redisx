import { describe, it, expect, afterEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { CLIENT_MANAGER, RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, SessionLimitExceededError, type ISessionService, type ISessionStore, type ISessionPluginOptions, type ISessionEventInfo } from '../../src';

/**
 * End-to-end validation on the in-memory driver — NO Redis. Exercises the full
 * stack (service -> store adapter -> Lua scripts -> memory Lua interpreter)
 * through production code.
 *
 * NOTE: the store adapter reads time via Date.now(), so TTL/cap scenarios use
 * small real timings and real waits (⚠ real timers).
 */
describe('Session on the in-memory driver (no Redis)', () => {
  let app: TestingModule | undefined;

  interface IBooted {
    service: ISessionService<Record<string, unknown>>;
    store: ISessionStore;
  }

  async function boot(options: ISessionPluginOptions = {}): Promise<IBooted> {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new SessionPlugin(options)],
        }),
      ],
    }).compile();
    await app.init();
    return {
      service: app.get<ISessionService<Record<string, unknown>>>(SESSION_SERVICE),
      store: app.get<ISessionStore>(SESSION_STORE),
    };
  }

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

  const userSession = (userId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ cookie: { maxAge: 60_000 }, passport: { user: userId }, ...extra });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs the full anonymous session lifecycle over Lua', async () => {
    // Given
    const { store } = await boot();

    // When: write, read, touch, destroy
    await store.set('sid-1', { cookie: {}, cart: [1, 2] });
    const read = await store.get('sid-1');
    const metaBefore = await store.getMetadata('sid-1');
    await wait(10);
    const touched = await store.touch('sid-1');
    const metaAfter = await store.getMetadata('sid-1');
    const destroyed = await store.destroy('sid-1');

    // Then
    expect(read).toEqual({ cookie: {}, cart: [1, 2] });
    expect(metaBefore).not.toBeNull();
    expect(metaBefore?.userId).toBeUndefined();
    expect(touched).toBe(true);
    expect(metaAfter!.lastSeenAt).toBeGreaterThan(metaBefore!.lastSeenAt);
    expect(metaAfter!.expiresAt).toBeGreaterThan(metaBefore!.expiresAt);
    expect(metaAfter!.createdAt).toBe(metaBefore!.createdAt);
    expect(destroyed).toBe(true);
    expect(await store.get('sid-1')).toBeNull();
    expect(await store.destroy('sid-1')).toBe(false);
  });

  it('preserves createdAt across re-saves', async () => {
    // Given
    const { store } = await boot();
    await store.set('sid-1', { cookie: {}, step: 1 });
    const first = await store.getMetadata('sid-1');

    // When
    await wait(10);
    await store.set('sid-1', { cookie: {}, step: 2 });
    const second = await store.getMetadata('sid-1');

    // Then
    expect(await store.get('sid-1')).toEqual({ cookie: {}, step: 2 });
    expect(second!.createdAt).toBe(first!.createdAt);
    expect(second!.lastSeenAt).toBeGreaterThan(first!.lastSeenAt);
  });

  it('builds the per-user device page with metadata and counts', async () => {
    // Given
    const { service, store } = await boot();
    await store.set('sid-a', userSession('user-1'));
    await store.set('sid-b', userSession('user-1'));
    await store.set('sid-c', userSession('user-2'));
    await store.set('sid-anon', { cookie: {} });

    // When
    await service.recordActivity('sid-a', { ip: '10.0.0.1', userAgent: 'Chrome on Mac' });
    const devices = await service.getSessionsByUser('user-1');

    // Then
    expect(devices.map((d) => d.id).sort()).toEqual(['sid-a', 'sid-b']);
    const deviceA = devices.find((d) => d.id === 'sid-a');
    expect(deviceA?.metadata?.ip).toBe('10.0.0.1');
    expect(deviceA?.metadata?.userAgent).toBe('Chrome on Mac');
    expect(deviceA?.metadata?.userId).toBe('user-1');
    expect(await service.countByUser('user-1')).toBe(2);
    expect(await service.countByUser('user-2')).toBe(1);
    expect(await service.count()).toBe(4);
  });

  it('revokes everywhere except the current device', async () => {
    // Given
    const events: ISessionEventInfo[] = [];
    const { service, store } = await boot({ events: { onRevoked: (info) => void events.push(info) } });
    await store.set('sid-old', userSession('user-1'));
    await store.set('sid-phone', userSession('user-1'));
    await store.set('sid-current', userSession('user-1'));

    // When
    const revoked = await service.revokeAllExcept('user-1', 'sid-current');

    // Then
    expect(revoked).toBe(2);
    expect(await store.get('sid-old')).toBeNull();
    expect(await store.get('sid-phone')).toBeNull();
    expect(await store.get('sid-current')).not.toBeNull();
    expect(await service.countByUser('user-1')).toBe(1);
    await vi.waitFor(() => expect(events.map((e) => e.sessionId).sort()).toEqual(['sid-old', 'sid-phone']));
  });

  it('revokes all sessions of a user', async () => {
    // Given
    const { service, store } = await boot();
    await store.set('sid-a', userSession('user-1'));
    await store.set('sid-b', userSession('user-1'));

    // When
    const revoked = await service.revokeAll('user-1');

    // Then
    expect(revoked).toBe(2);
    expect(await service.getSessionsByUser('user-1')).toEqual([]);
    expect(await service.count()).toBe(0);
  });

  it('rejects logins over the seat limit under the reject policy', async () => {
    // Given
    const { store } = await boot({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' });
    await store.set('sid-1', userSession('user-1'));
    await store.set('sid-2', userSession('user-1'));

    // When / Then: a third seat is refused, existing sessions stay intact
    await expect(store.set('sid-3', userSession('user-1'))).rejects.toBeInstanceOf(SessionLimitExceededError);
    expect(await store.get('sid-3')).toBeNull();
    expect(await store.get('sid-1')).not.toBeNull();
    expect(await store.get('sid-2')).not.toBeNull();

    // Re-saving an existing seat is never rejected
    await expect(store.set('sid-2', userSession('user-1', { step: 2 }))).resolves.toBeUndefined();

    // Other users are unaffected
    await expect(store.set('sid-other', userSession('user-2'))).resolves.toBeUndefined();
  });

  it('evicts the oldest session over the seat limit under the evict-oldest policy', async () => {
    // Given
    const { service, store } = await boot({ maxSessionsPerUser: 2, maxSessionsPolicy: 'evict-oldest' });
    await store.set('sid-oldest', userSession('user-1'));
    await wait(10);
    await store.set('sid-mid', userSession('user-1'));
    await wait(10);

    // When
    await store.set('sid-new', userSession('user-1'));

    // Then
    expect(await store.get('sid-oldest')).toBeNull();
    expect(await store.get('sid-mid')).not.toBeNull();
    expect(await store.get('sid-new')).not.toBeNull();
    expect(await service.countByUser('user-1')).toBe(2);
  });

  it('destroys sessions that outlive the absolute lifetime cap despite activity', async () => {
    // Given: the TTL is clamped to the remaining cap window at every write/touch
    const { store } = await boot({ absoluteLifetimeMs: 120 });
    await store.set('sid-1', userSession('user-1'));

    // Touch keeps the session alive within the cap window
    expect(await store.touch('sid-1')).toBe(true);
    expect(await store.get('sid-1')).not.toBeNull();

    // When: the cap elapses despite activity
    await wait(150);

    // Then: the session is gone regardless of the 1-day default TTL
    expect(await store.get('sid-1')).toBeNull();
    expect(await store.getMetadata('sid-1')).toBeNull();
    expect(await store.touch('sid-1')).toBe(false);
  });

  it('catches pre-cap sessions on access and emits onExpiredByCap', async () => {
    // Given: a session whose createdAt predates the cap window (e.g. the cap
    // was introduced/tightened after the session was created), so its TTL was
    // never clamped and the key is still alive past the cap
    const capEvents: ISessionEventInfo[] = [];
    const { store } = await boot({ absoluteLifetimeMs: 5_000, events: { onExpiredByCap: (info) => void capEvents.push(info) } });
    await store.set('sid-1', userSession('user-1'));
    const manager = app!.get<{ getClient(name: string): Promise<{ hset(key: string, field: string, value: string): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');
    await driver.hset('sess:{sid-1}:meta', 'createdAt', String(Date.now() - 10_000));

    // When: the next read finds the cap exceeded
    const result = await store.get('sid-1');

    // Then: the session is destroyed and the audit event fires
    expect(result).toBeNull();
    expect(await store.getMetadata('sid-1')).toBeNull();
    await vi.waitFor(() => expect(capEvents).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]));
  });

  it('rejects a touch after the cap elapsed', async () => {
    // Given
    const { store } = await boot({ absoluteLifetimeMs: 120 });
    await store.set('sid-1', { cookie: {} });

    // When
    await wait(150);

    // Then
    expect(await store.touch('sid-1')).toBe(false);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('lets natural TTL expiry drop sessions out of counts and listings', async () => {
    // Given
    const { service, store } = await boot();
    await store.set('sid-1', userSession('user-1'), { ttlMs: 100 });
    expect(await service.count()).toBe(1);

    // When
    await wait(150);

    // Then
    expect(await store.get('sid-1')).toBeNull();
    expect(await service.count()).toBe(0);
    expect(await service.countByUser('user-1')).toBe(0);
    expect(await service.getSessionsByUser('user-1')).toEqual([]);
  });

  it('emits created and destroyed lifecycle events', async () => {
    // Given
    const created: ISessionEventInfo[] = [];
    const destroyed: ISessionEventInfo[] = [];
    const { store } = await boot({ events: { onCreated: (info) => void created.push(info), onDestroyed: (info) => void destroyed.push(info) } });

    // When
    await store.set('sid-1', userSession('user-1'));
    await store.set('sid-1', userSession('user-1', { step: 2 })); // re-save, no second onCreated
    await store.destroy('sid-1');

    // Then
    await vi.waitFor(() => {
      expect(created).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]);
      expect(destroyed).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]);
    });
  });

  it('exposes getSession for a single-session lookup', async () => {
    // Given
    const { service, store } = await boot();
    await store.set('sid-1', userSession('user-1', { theme: 'dark' }));

    // When
    const info = await service.getSession('sid-1');

    // Then
    expect(info?.id).toBe('sid-1');
    expect(info?.data['theme']).toBe('dark');
    expect(info?.metadata?.userId).toBe('user-1');
    expect(await service.getSession('nope')).toBeNull();
  });
});
