import { describe, it, expect, vi } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';

import type { ICachePluginOptions } from '../../src/shared/types';
import { StampedeProtectionService } from '../../src/stampede/infrastructure/stampede-protection.service';

function createMockDriver(): IRedisDriver {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(0),
    eval: vi.fn().mockResolvedValue(1),
  } as unknown as IRedisDriver;
}

describe('StampedeProtectionService — mode: l1-only', () => {
  it('coalesces concurrent loads via singleflight WITHOUT any distributed-lock driver calls', async () => {
    // Given l1-only stampede over a driver that must never be touched
    const driver = createMockDriver();
    const service = new StampedeProtectionService({ mode: 'l1-only' } as ICachePluginOptions, driver);

    let loads = 0;
    const loader = vi.fn().mockImplementation(async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 30));
      return 'value';
    });

    // When 10 callers race for the same cold key
    const results = await Promise.all(Array.from({ length: 10 }, () => service.protect('k', loader)));

    // Then — exactly one load, everyone gets the value, and the driver was never used
    expect(results.every((r) => r.value === 'value')).toBe(true);
    expect(loads).toBe(1);
    expect(driver.set).not.toHaveBeenCalled();
    expect(driver.exists).not.toHaveBeenCalled();
    expect(driver.eval).not.toHaveBeenCalled();
  });

  it('still acquires the distributed lock in l1-l2 mode (unchanged behavior)', async () => {
    // Given the default topology
    const driver = createMockDriver();
    const service = new StampedeProtectionService({ mode: 'l1-l2' } as ICachePluginOptions, driver);

    // When a single load runs
    await service.protect('k', async () => 'value');

    // Then the distributed lock was attempted
    expect(driver.set).toHaveBeenCalled();
  });
});
