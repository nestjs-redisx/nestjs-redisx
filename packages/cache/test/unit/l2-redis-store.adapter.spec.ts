import { describe, it, expect } from 'vitest';
import { L2RedisStoreAdapter } from '../../src/cache/infrastructure/adapters/l2-redis-store.adapter';

describe('L2RedisStoreAdapter', () => {
  it('should be defined', () => {
    // Given/When/Then
    expect(L2RedisStoreAdapter).toBeDefined();
    expect(L2RedisStoreAdapter.name).toBe('L2RedisStoreAdapter');
  });

  it('should have a constructor', () => {
    // Given/When/Then
    expect(typeof L2RedisStoreAdapter).toBe('function');
    expect(L2RedisStoreAdapter.prototype.constructor).toBe(L2RedisStoreAdapter);
  });
});
