import { describe, it, expect, afterEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { CLIENT_MANAGER, RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, SessionLimitExceededError, type ISessionService, type ISessionStore, type ISessionPluginOptions, type ISessionEventInfo } from '../../src';
import { GET_SESSION_SCRIPT } from '../../src/session/infrastructure/scripts/lua-scripts';

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

  it('keeps revocation working for rolling sessions (index key TTL slides with touch)', async () => {
    // Given: short TTL, session kept alive by touch alone (express-session
    // with resave:false touches without saving)
    const { service, store } = await boot({ defaultTtlMs: 300 });
    await store.set('sid-roll', userSession('user-1'));

    // When: the index key's original 300ms TTL elapses while touches continue
    for (let i = 0; i < 6; i++) {
      await wait(100);
      expect(await store.touch('sid-roll')).toBe(true);
    }

    // Then: device page, counters, and revokeAll still see the session
    expect(await service.countByUser('user-1')).toBe(1);
    expect((await service.getSessionsByUser('user-1')).map((d) => d.id)).toEqual(['sid-roll']);
    expect(await service.revokeAll('user-1')).toBe(1);
    expect(await store.get('sid-roll')).toBeNull();
  });

  it('gives index keys a TTL so they never leak after their sessions die', async () => {
    // Given
    const { store } = await boot({ defaultTtlMs: 60_000 });
    await store.set('sid-1', userSession('user-1'));
    await store.touch('sid-1');
    const manager = app!.get<{ getClient(name: string): Promise<{ pttl(key: string): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');

    // Then: both index keys expire on their own
    expect(await driver.pttl('sess:user:user-1')).toBeGreaterThan(0);
    expect(await driver.pttl('sess:index')).toBeGreaterThan(0);
  });

  it('does not lock the user out when reject-policy seats die by the absolute cap', async () => {
    // Given: 1 seat, reject policy, 150ms lifetime cap, 1-day default TTL
    const { store } = await boot({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject', absoluteLifetimeMs: 150 });
    await store.set('sid-1', userSession('user-1'));

    // When: the session dies by the cap without ever being read again
    await wait(220);

    // Then: a fresh login must succeed — the index entry's score is clamped
    // to the capped expiry, so the seat frees together with the session
    await expect(store.set('sid-2', userSession('user-1'))).resolves.toBeUndefined();
    expect(await store.get('sid-2')).not.toBeNull();
  });

  it('moves the sid between user indexes on an account switch', async () => {
    // Given: alice's session re-saved under bob (no sid regeneration)
    const { service, store } = await boot();
    await store.set('sid-shared', userSession('alice'));

    // When
    await store.set('sid-shared', userSession('bob', { secret: 'bob-data' }));

    // Then: alice's device page must NOT leak bob's session
    expect(await service.getSessionsByUser('alice')).toEqual([]);
    expect(await service.countByUser('alice')).toBe(0);
    expect((await service.getSessionsByUser('bob')).map((d) => d.id)).toEqual(['sid-shared']);

    // And destroy cleans the (only) current owner's index
    await store.destroy('sid-shared');
    expect(await service.countByUser('bob')).toBe(0);
  });

  it('treats a missing session as a plain miss on the memory driver (no corrupt-payload destroy)', async () => {
    // Given: parity with real Redis — nil bulk replies must reach Lua as false
    const { store } = await boot();
    const manager = app!.get<{ getClient(name: string): Promise<{ eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');

    // When: the get script runs directly against missing keys
    const raw = (await driver.eval(GET_SESSION_SCRIPT, ['sess:{missing}', 'sess:{missing}:meta'], [Date.now(), 0])) as number[];

    // Then: status 0 (miss), NOT status 1 with a bogus payload
    expect(raw[0]).toBe(0);
    expect(await store.get('missing')).toBeNull();
  });

  it('re-arms the absolute cap when session metadata is lost (no immortal sessions)', async () => {
    // Given: cap 200ms; the metadata key vanishes (eviction / TTL skew)
    const { store } = await boot({ absoluteLifetimeMs: 200, defaultTtlMs: 60_000 });
    await store.set('sid-1', userSession('user-1'));
    const manager = app!.get<{ getClient(name: string): Promise<{ del(...keys: string[]): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');
    await driver.del('sess:{sid-1}:meta');

    // When: the session keeps being touched past the (re-armed) cap window
    expect(await store.touch('sid-1')).toBe(true);
    await wait(250);

    // Then: the cap fires from the re-stamped createdAt instead of resetting
    // on every touch
    expect(await store.touch('sid-1')).toBe(false);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('frees the phantom seat when destroying a session whose payload was evicted', async () => {
    // Given: 1-seat reject policy; the payload key vanishes but metadata and
    // the index entry linger (partial eviction)
    const { store } = await boot({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject' });
    await store.set('sid-ghost', userSession('user-1'));
    const manager = app!.get<{ getClient(name: string): Promise<{ del(...keys: string[]): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');
    await driver.del('sess:{sid-ghost}');

    // When: destroy is the public repair path
    await store.destroy('sid-ghost');

    // Then: the seat is free again
    await expect(store.set('sid-new', userSession('user-1'))).resolves.toBeUndefined();
    expect(await store.get('sid-new')).not.toBeNull();
  });

  it('frees the seat when destroying a session whose metadata was lost', async () => {
    // Given: 1-seat reject policy; the metadata key is evicted (payload alive)
    const { store } = await boot({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject' });
    await store.set('sid-1', userSession('user-1'));
    const manager = app!.get<{ getClient(name: string): Promise<{ del(...keys: string[]): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');
    await driver.del('sess:{sid-1}:meta');

    // When: the user logs out (destroy re-derives the owner from the payload)
    expect(await store.destroy('sid-1')).toBe(true);

    // Then: the seat is free — no lockout
    expect(await store.countByUser('user-1')).toBe(0);
    await expect(store.set('sid-2', userSession('user-1'))).resolves.toBeUndefined();
  });

  it('repairs lost ownership on read: the device page and revokeAll work again after metadata loss', async () => {
    // Given: metadata key vanishes entirely (eviction / TTL skew)
    const { service, store } = await boot();
    await store.set('sid-1', userSession('user-1'));
    const manager = app!.get<{ getClient(name: string): Promise<{ del(...keys: string[]): Promise<number> }> }>(CLIENT_MANAGER);
    const driver = await manager.getClient('default');
    await driver.del('sess:{sid-1}:meta');

    // When: the next read heals metadata AND re-derives the owner from the payload
    expect(await store.get('sid-1')).not.toBeNull();

    // Then: identity, metadata, device page, and revocation all recovered
    const meta = await store.getMetadata('sid-1');
    expect(meta?.userId).toBe('user-1');
    expect((await service.getSessionsByUser('user-1')).map((d) => d.id)).toEqual(['sid-1']);
    expect(await service.revokeAll('user-1')).toBe(1);
    expect(await store.get('sid-1')).toBeNull();
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
