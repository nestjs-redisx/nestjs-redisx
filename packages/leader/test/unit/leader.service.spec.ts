import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from 'vitest';
import { LeaderService } from '../../src/leader/application/services/leader.service';
import type { ILeaderStore } from '../../src/leader/application/ports/leader-store.port';
import type { ILeaderPluginOptions } from '../../src/shared/types';
import { InvalidLeaderConfigError, LeaderStoreError } from '../../src/shared/errors';
import { clearRegisteredLeaderGroups, registerLeaderGroup } from '../../src/leader/api/decorators/leader-only.decorator';

const TTL = 15_000;
const RENEW = 5_000;
const RETRY = 2_000;

describe('LeaderService', () => {
  let store: MockedObject<ILeaderStore>;
  let options: ILeaderPluginOptions;
  let service: LeaderService;

  function createService(extra: Partial<ILeaderPluginOptions> = {}): LeaderService {
    return new LeaderService({ ...options, ...extra }, store);
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    clearRegisteredLeaderGroups();

    store = {
      acquire: vi.fn().mockResolvedValue(true),
      renew: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      getHolder: vi.fn().mockResolvedValue(null),
    } as unknown as MockedObject<ILeaderStore>;

    options = {
      instanceId: 'node-1',
      keyPrefix: 'leader:',
      ttlMs: TTL,
      renewIntervalMs: RENEW,
      retryIntervalMs: RETRY,
    };
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('bootstrap', () => {
    it('should run the first election immediately and become leader of the default group', async () => {
      // Given
      service = createService();

      // When
      await service.onModuleInit();

      // Then
      expect(store.acquire).toHaveBeenCalledWith('leader:default', 'node-1', TTL);
      expect(service.isLeader()).toBe(true);
      expect(service.isLeader('default')).toBe(true);
    });

    it('should stay follower when the key is already held', async () => {
      // Given
      store.acquire.mockResolvedValue(false);
      service = createService();

      // When
      await service.onModuleInit();

      // Then
      expect(service.isLeader()).toBe(false);
    });

    it('should start elections for configured extra groups', async () => {
      // Given
      service = createService({ groups: ['reports', 'cleanup'] });

      // When
      await service.onModuleInit();

      // Then
      expect(store.acquire).toHaveBeenCalledWith('leader:reports', 'node-1', TTL);
      expect(store.acquire).toHaveBeenCalledWith('leader:cleanup', 'node-1', TTL);
      expect(service.getGroups().sort()).toEqual(['cleanup', 'default', 'reports']);
    });

    it('should start elections for groups registered by @LeaderOnly at decoration time', async () => {
      // Given
      registerLeaderGroup('decorated-group');
      service = createService();

      // When
      await service.onModuleInit();

      // Then
      expect(store.acquire).toHaveBeenCalledWith('leader:decorated-group', 'node-1', TTL);
      expect(service.getGroups()).toContain('decorated-group');
    });

    it('should expose the instance id', () => {
      // Given
      service = createService();

      // Then
      expect(service.instanceId).toBe('node-1');
    });

    it('should generate a unique instance id when not configured', () => {
      // Given
      service = createService({ instanceId: undefined });
      const other = new LeaderService({ ...options, instanceId: undefined }, store);

      // Then
      expect(service.instanceId).toBeTruthy();
      expect(service.instanceId).not.toBe(other.instanceId);
    });
  });

  describe('follower retry', () => {
    it('should retry acquisition on the retry interval and get elected when the seat frees up', async () => {
      // Given
      store.acquire.mockResolvedValueOnce(false);
      service = createService();
      await service.onModuleInit();
      expect(service.isLeader()).toBe(false);

      // When — seat frees up before the next retry
      store.acquire.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(RETRY);

      // Then
      expect(service.isLeader()).toBe(true);
      expect(store.acquire).toHaveBeenCalledTimes(2);
    });

    it('should keep retrying while the seat is held', async () => {
      // Given
      store.acquire.mockResolvedValue(false);
      service = createService();
      await service.onModuleInit();

      // When
      await vi.advanceTimersByTimeAsync(RETRY * 3);

      // Then
      expect(store.acquire.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(service.isLeader()).toBe(false);
    });

    it('should survive acquire errors and keep the loop alive', async () => {
      // Given
      store.acquire.mockRejectedValue(new Error('redis down'));
      service = createService();

      // When
      await service.onModuleInit();
      await vi.advanceTimersByTimeAsync(RETRY * 2);

      // Then — still follower, loop still running, no unhandled rejection
      expect(service.isLeader()).toBe(false);
      expect(store.acquire.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('heartbeat', () => {
    it('should renew the lease on the renew interval while leader', async () => {
      // Given
      service = createService();
      await service.onModuleInit();

      // When
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then
      expect(store.renew).toHaveBeenCalledWith('leader:default', 'node-1', TTL);
      expect(service.isLeader()).toBe(true);
    });

    it('should demote and emit onLost(expired) when the renewal is rejected', async () => {
      // Given
      const onLost = vi.fn();
      service = createService({ onLost });
      await service.onModuleInit();
      store.renew.mockResolvedValue(false);

      // When
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then
      expect(service.isLeader()).toBe(false);
      expect(onLost).toHaveBeenCalledWith('default', 'expired');
    });

    it('should demote on renewal ERRORS too (fail-safe: unconfirmed lease is no lease)', async () => {
      // Given
      service = createService();
      await service.onModuleInit();
      store.renew.mockRejectedValue(new Error('redis down'));

      // When
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then
      expect(service.isLeader()).toBe(false);
    });

    it('should try to win again after demotion', async () => {
      // Given
      service = createService();
      await service.onModuleInit();
      store.renew.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(RENEW);
      expect(service.isLeader()).toBe(false);

      // When — next follower retry re-acquires
      await vi.advanceTimersByTimeAsync(RETRY);

      // Then
      expect(service.isLeader()).toBe(true);
    });

    it('should report not-leader when the local lease expires even if the loop stalled', async () => {
      // Given — jump wall-clock past the lease WITHOUT firing timers
      service = createService();
      await service.onModuleInit();
      expect(service.isLeader()).toBe(true);

      // When
      vi.setSystemTime(Date.now() + TTL + 1);

      // Then
      expect(service.isLeader()).toBe(false);
    });
  });

  describe('events and metrics', () => {
    it('should emit onElected with the group name', async () => {
      // Given
      const onElected = vi.fn();
      service = createService({ onElected });

      // When
      await service.onModuleInit();

      // Then
      expect(onElected).toHaveBeenCalledWith('default');
    });

    it('should not break the loop when a callback throws', async () => {
      // Given
      const onElected = vi.fn(() => {
        throw new Error('listener bug');
      });
      service = createService({ onElected });

      // When
      await service.onModuleInit();
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then — still leader, heartbeat still running
      expect(service.isLeader()).toBe(true);
      expect(store.renew).toHaveBeenCalled();
    });

    it('should increment elected/lost counters when a metrics service is present', async () => {
      // Given
      const metrics = { incrementCounter: vi.fn() };
      service = new LeaderService(options, store, metrics);
      await service.onModuleInit();
      store.renew.mockResolvedValue(false);

      // When
      await vi.advanceTimersByTimeAsync(RENEW);

      // Then
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_leader_elected_total', { group: 'default' });
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_leader_lost_total', { group: 'default', reason: 'expired' });
    });
  });

  describe('stepDown', () => {
    it('should release the lease, emit onLost(stepdown), and pause candidacy for one ttl', async () => {
      // Given
      const onLost = vi.fn();
      service = createService({ onLost });
      await service.onModuleInit();
      store.acquire.mockClear();

      // When
      await service.stepDown();

      // Then
      expect(store.release).toHaveBeenCalledWith('leader:default', 'node-1');
      expect(service.isLeader()).toBe(false);
      expect(onLost).toHaveBeenCalledWith('default', 'stepdown');

      // And — no re-candidacy during the cooldown window
      await vi.advanceTimersByTimeAsync(TTL - RETRY);
      expect(store.acquire).not.toHaveBeenCalled();

      // And — candidacy resumes after the cooldown
      await vi.advanceTimersByTimeAsync(TTL);
      expect(store.acquire).toHaveBeenCalled();
    });

    it('should be a no-op for an unknown group', async () => {
      // Given
      service = createService();
      await service.onModuleInit();

      // When/Then
      await expect(service.stepDown('never-started')).resolves.toBeUndefined();
      expect(store.release).not.toHaveBeenCalledWith('leader:never-started', expect.anything());
    });

    it('should not throw when the release fails on the store', async () => {
      // Given
      service = createService();
      await service.onModuleInit();
      store.release.mockRejectedValue(new Error('down'));

      // When/Then — local demotion still happens
      await expect(service.stepDown()).resolves.toBeUndefined();
      expect(service.isLeader()).toBe(false);
    });
  });

  describe('runIfLeader', () => {
    it('should execute the function only when leader', async () => {
      // Given
      service = createService();
      await service.onModuleInit();

      // When
      const result = await service.runIfLeader(() => 'done');

      // Then
      expect(result).toBe('done');
    });

    it('should skip and return undefined when not leader', async () => {
      // Given
      store.acquire.mockResolvedValue(false);
      service = createService();
      await service.onModuleInit();
      const fn = vi.fn();

      // When
      const result = await service.runIfLeader(fn);

      // Then
      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('getLeaderId', () => {
    it('should read the current holder from the store', async () => {
      // Given
      service = createService();
      store.getHolder.mockResolvedValue('node-2');

      // When
      const holder = await service.getLeaderId();

      // Then
      expect(holder).toBe('node-2');
      expect(store.getHolder).toHaveBeenCalledWith('leader:default');
    });

    it('should propagate store failures as LeaderStoreError', async () => {
      // Given
      service = createService();
      store.getHolder.mockRejectedValue(new LeaderStoreError('down'));

      // When/Then
      await expect(service.getLeaderId()).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('validation', () => {
    it('should fail fast on an invalid per-call group', async () => {
      // Given
      service = createService();
      await service.onModuleInit();

      // When/Then
      expect(() => service.isLeader('')).toThrow(InvalidLeaderConfigError);
      await expect(service.getLeaderId('')).rejects.toThrow(InvalidLeaderConfigError);
    });
  });

  describe('shutdown', () => {
    it('should stop all timers, release held leases, and emit onLost(shutdown)', async () => {
      // Given
      const onLost = vi.fn();
      service = createService({ onLost, groups: ['reports'] });
      await service.onModuleInit();
      expect(service.isLeader('reports')).toBe(true);

      // When
      await service.onModuleDestroy();

      // Then
      expect(vi.getTimerCount()).toBe(0);
      expect(store.release).toHaveBeenCalledWith('leader:default', 'node-1');
      expect(store.release).toHaveBeenCalledWith('leader:reports', 'node-1');
      expect(onLost).toHaveBeenCalledWith('default', 'shutdown');
      expect(onLost).toHaveBeenCalledWith('reports', 'shutdown');
      expect(service.isLeader()).toBe(false);
    });

    it('should not release anything when it was never leader', async () => {
      // Given
      store.acquire.mockResolvedValue(false);
      service = createService();
      await service.onModuleInit();

      // When
      await service.onModuleDestroy();

      // Then
      expect(store.release).not.toHaveBeenCalled();
    });

    it('should be safe to destroy twice', async () => {
      // Given
      service = createService();
      await service.onModuleInit();

      // When/Then
      await service.onModuleDestroy();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
