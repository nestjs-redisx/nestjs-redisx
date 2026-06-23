import { describe, it, expect } from 'vitest';
import { createDriver } from '@nestjs-redisx/core';

import { registerMemoryDriver } from '../../src/memory/api/register-memory-driver';
import { MemoryRedisAdapter } from '../../src/memory/infrastructure/adapters/memory-redis.adapter';
import { MEMORY_DRIVER_TYPE } from '../../src/shared/constants';

/**
 * Unit tests for memory-driver registration with the core driver registry.
 */
describe('registerMemoryDriver', () => {
  it('registers the memory driver so createDriver can build it', () => {
    registerMemoryDriver();
    const driver = createDriver({ type: 'single', host: 'x', port: 1 }, { type: MEMORY_DRIVER_TYPE });
    expect(driver).toBeInstanceOf(MemoryRedisAdapter);
  });

  it('is idempotent (safe to call multiple times)', () => {
    expect(() => {
      registerMemoryDriver();
      registerMemoryDriver();
    }).not.toThrow();
  });
});
