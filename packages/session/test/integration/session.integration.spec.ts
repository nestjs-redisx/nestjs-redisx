import { describe, it, expect, afterEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { CLIENT_MANAGER, RedisModule, type IRedisDriver, type RedisClientManager } from '@nestjs-redisx/core';

import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, SessionLimitExceededError, type ISessionService, type ISessionStore, type ISessionPluginOptions, type ISessionEventInfo } from '../../src';

/**
 * Integration tests against a LIVE Redis instance on REDIS_HOST:REDIS_PORT
 * (defaults to localhost:6379). Skipped when SKIP_INTEGRATION=true so CI runs
 * the hermetic memory-driver suite instead.
 *
 * Parity with the in-memory suite (scriptLoad + EVALSHA + real Lua) plus
 * real-Redis specifics: PTTL alignment of payload/metadata and index TTLs.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeIntegration('Session (live Redis)', () => {
  let app: TestingModule | undefined;
  let n = 0;
  const uniquePrefix = (): string => `sess-it:${process.pid}:${Date.now()}:${n++}:`;

  interface IBooted {
    service: ISessionService<Record<string, unknown>>;
    store: ISessionStore;
    driver: IRedisDriver;
    prefix: string;
  }

  async function boot(options: Omit<ISessionPluginOptions, 'keyPrefix'> = {}): Promise<IBooted> {
    const prefix = uniquePrefix();
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new SessionPlugin({ ...options, keyPrefix: prefix })],
        }),
      ],
    }).compile();
    await app.init();
    const manager = app.get<RedisClientManager>(CLIENT_MANAGER);
    return {
      service: app.get<ISessionService<Record<string, unknown>>>(SESSION_SERVICE),
      store: app.get<ISessionStore>(SESSION_STORE),
      driver: await manager.getClient('default'),
      prefix,
    };
  }

  const userSession = (userId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ cookie: { maxAge: 60_000 }, passport: { user: userId }, ...extra });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs the full session lifecycle over real Redis', async () => {
    // Given
    const { store } = await boot();

    // When
    await store.set('sid-1', { cookie: {}, cart: [1, 2] });
    const read = await store.get('sid-1');
    const metaBefore = await store.getMetadata('sid-1');
    await wait(15);
    const touched = await store.touch('sid-1');
    const metaAfter = await store.getMetadata('sid-1');
    const destroyed = await store.destroy('sid-1');

    // Then
    expect(read).toEqual({ cookie: {}, cart: [1, 2] });
    expect(touched).toBe(true);
    expect(metaAfter!.lastSeenAt).toBeGreaterThan(metaBefore!.lastSeenAt);
    expect(metaAfter!.createdAt).toBe(metaBefore!.createdAt);
    expect(destroyed).toBe(true);
    expect(await store.get('sid-1')).toBeNull();
  });

  it('applies the write TTL to both payload and metadata keys', async () => {
    // Given
    const { store, driver, prefix } = await boot();

    // When
    await store.set('sid-1', { cookie: {} }, { ttlMs: 30_000 });

    // Then
    const dataTtl = await driver.pttl(`${prefix}{sid-1}`);
    const metaTtl = await driver.pttl(`${prefix}{sid-1}:meta`);
    expect(dataTtl).toBeGreaterThan(25_000);
    expect(dataTtl).toBeLessThanOrEqual(30_000);
    expect(metaTtl).toBeGreaterThan(25_000);
    expect(metaTtl).toBeLessThanOrEqual(30_000);
  });

  it('expires sessions naturally and sweeps them from counts', async () => {
    // Given
    const { service, store } = await boot();
    await store.set('sid-1', userSession('user-1'), { ttlMs: 150 });
    expect(await service.count()).toBe(1);
    expect(await service.countByUser('user-1')).toBe(1);

    // When
    await wait(250);

    // Then
    expect(await store.get('sid-1')).toBeNull();
    expect(await service.count()).toBe(0);
    expect(await service.countByUser('user-1')).toBe(0);
    expect(await service.getSessionsByUser('user-1')).toEqual([]);
  });

  it('builds the device page and revokes everywhere except the current device', async () => {
    // Given
    const revoked: ISessionEventInfo[] = [];
    const { service, store } = await boot({ events: { onRevoked: (info) => void revoked.push(info) } });
    await store.set('sid-laptop', userSession('user-1'));
    await store.set('sid-phone', userSession('user-1'));
    await store.set('sid-current', userSession('user-1'));
    await service.recordActivity('sid-laptop', { ip: '10.0.0.1', userAgent: 'Chrome on Mac' });

    // When
    const devices = await service.getSessionsByUser('user-1');
    const revokedCount = await service.revokeAllExcept('user-1', 'sid-current');

    // Then
    expect(devices.map((d) => d.id).sort()).toEqual(['sid-current', 'sid-laptop', 'sid-phone']);
    expect(devices.find((d) => d.id === 'sid-laptop')?.metadata?.userAgent).toBe('Chrome on Mac');
    expect(revokedCount).toBe(2);
    expect(await store.get('sid-laptop')).toBeNull();
    expect(await store.get('sid-current')).not.toBeNull();
    await vi.waitFor(() => expect(revoked.map((e) => e.sessionId).sort()).toEqual(['sid-laptop', 'sid-phone']));
  });

  it('enforces the seat limit with the reject policy atomically', async () => {
    // Given
    const { store } = await boot({ maxSessionsPerUser: 2, maxSessionsPolicy: 'reject' });
    await store.set('sid-1', userSession('user-1'));
    await store.set('sid-2', userSession('user-1'));

    // When / Then
    await expect(store.set('sid-3', userSession('user-1'))).rejects.toBeInstanceOf(SessionLimitExceededError);
    expect(await store.get('sid-3')).toBeNull();
    await expect(store.set('sid-2', userSession('user-1', { step: 2 }))).resolves.toBeUndefined();
    await expect(store.set('sid-other', userSession('user-2'))).resolves.toBeUndefined();
  });

  it('evicts the oldest session under the evict-oldest policy', async () => {
    // Given
    const { service, store } = await boot({ maxSessionsPerUser: 2, maxSessionsPolicy: 'evict-oldest' });
    await store.set('sid-oldest', userSession('user-1'));
    await wait(15);
    await store.set('sid-mid', userSession('user-1'));
    await wait(15);

    // When
    await store.set('sid-new', userSession('user-1'));

    // Then
    expect(await store.get('sid-oldest')).toBeNull();
    expect(await store.get('sid-mid')).not.toBeNull();
    expect(await store.get('sid-new')).not.toBeNull();
    expect(await service.countByUser('user-1')).toBe(2);
  });

  it('clamps the TTL to the absolute lifetime cap', async () => {
    // Given
    const { store, driver, prefix } = await boot({ absoluteLifetimeMs: 5_000 });

    // When: 1-day default TTL requested, but only 5s of cap remain
    await store.set('sid-1', userSession('user-1'));

    // Then
    const dataTtl = await driver.pttl(`${prefix}{sid-1}`);
    expect(dataTtl).toBeGreaterThan(0);
    expect(dataTtl).toBeLessThanOrEqual(5_000);
  });

  it('catches pre-cap sessions on access and emits onExpiredByCap', async () => {
    // Given: a session whose createdAt predates the cap window
    const capEvents: ISessionEventInfo[] = [];
    const { store, driver, prefix } = await boot({ absoluteLifetimeMs: 5_000, events: { onExpiredByCap: (info) => void capEvents.push(info) } });
    await store.set('sid-1', userSession('user-1'));
    await driver.hset(`${prefix}{sid-1}:meta`, 'createdAt', String(Date.now() - 10_000));

    // When
    const result = await store.get('sid-1');

    // Then
    expect(result).toBeNull();
    expect(await store.getMetadata('sid-1')).toBeNull();
    await vi.waitFor(() => expect(capEvents).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]));
  });

  it('emits created and destroyed lifecycle events', async () => {
    // Given
    const created: ISessionEventInfo[] = [];
    const destroyed: ISessionEventInfo[] = [];
    const { store } = await boot({ events: { onCreated: (info) => void created.push(info), onDestroyed: (info) => void destroyed.push(info) } });

    // When
    await store.set('sid-1', userSession('user-1'));
    await store.set('sid-1', userSession('user-1', { step: 2 }));
    await store.destroy('sid-1');

    // Then
    await vi.waitFor(() => {
      expect(created).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]);
      expect(destroyed).toEqual([{ sessionId: 'sid-1', userId: 'user-1' }]);
    });
  });

  it('self-heals corrupt payloads', async () => {
    // Given
    const { store, driver, prefix } = await boot();
    await store.set('sid-1', userSession('user-1'));
    await driver.set(`${prefix}{sid-1}`, '{not-json');

    // When / Then
    expect(await store.get('sid-1')).toBeNull();
    expect(await driver.exists(`${prefix}{sid-1}`)).toBe(0);
  });
});
