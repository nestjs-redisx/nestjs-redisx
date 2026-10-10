import { describe, it, expect } from 'vitest';
import { loadIoredis, loadNodeRedis, isDriverPackageInstalled } from '../../src/driver/infrastructure/driver-loader';
import { createDriver, registerDriver } from '../../src/driver/application/driver.factory';
import type { IRedisDriver } from '../../src/interfaces';

describe('driver-loader', () => {
  describe('loadIoredis', () => {
    it('should return the Redis and Cluster constructors', () => {
      // When
      const lib = loadIoredis();

      // Then
      expect(typeof lib.Redis).toBe('function');
      expect(typeof lib.Cluster).toBe('function');
    });

    it('should return the same (cached) library on repeated calls', () => {
      // When
      const first = loadIoredis();
      const second = loadIoredis();

      // Then
      expect(second.Redis).toBe(first.Redis);
      expect(second.Cluster).toBe(first.Cluster);
    });
  });

  describe('loadNodeRedis', () => {
    it('should return the createClient/createCluster/createSentinel factories', () => {
      // When
      const lib = loadNodeRedis();

      // Then
      expect(typeof lib.createClient).toBe('function');
      expect(typeof lib.createCluster).toBe('function');
      expect(typeof lib.createSentinel).toBe('function');
    });
  });

  describe('isDriverPackageInstalled', () => {
    it('should report both driver packages as installed in the workspace', () => {
      // Then
      expect(isDriverPackageInstalled('ioredis')).toBe(true);
      expect(isDriverPackageInstalled('redis')).toBe(true);
    });
  });

  describe('custom driver registry across module copies (dual-package hazard)', () => {
    it('should share registerDriver registrations with a second copy of the factory module', async () => {
      // Given - a second, independent instance of the factory module (the
      // ?copy query forces Vite to instantiate the module again), standing in
      // for the CJS/ESM copy pair a dual-build process can load.
      const fakeDriver = { id: 'dual-copy' } as unknown as IRedisDriver;
      registerDriver('dual-copy-probe', () => fakeDriver);

      // When - the OTHER copy resolves the driver type.
      const secondCopy: typeof import('../../src/driver/application/driver.factory') = await import('../../src/driver/application/driver.factory?copy=b' as string);
      const created = secondCopy.createDriver({ type: 'single', host: 'x' }, { type: 'dual-copy-probe' as never });

      // Then - one shared registry on globalThis, not one per module copy.
      expect(created).toBe(fakeDriver);
      expect(secondCopy.createDriver).not.toBe(createDriver);
    });
  });
});
