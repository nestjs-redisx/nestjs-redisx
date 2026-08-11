import { describe, it, expect } from 'vitest';

import { createNullRedisDriver } from '../../src/cache/infrastructure/adapters/null-redis-driver';

describe('createNullRedisDriver', () => {
  it('is never connected and connect/disconnect are safe no-ops', async () => {
    // Given
    const driver = createNullRedisDriver();

    // When / Then
    expect(driver.isConnected()).toBe(false);
    await expect(driver.connect()).resolves.toBeUndefined();
    await expect(driver.disconnect()).resolves.toBeUndefined();
    expect(await driver.ping()).toBe('PONG');
  });

  it('reads as a miss and writes as benign no-ops', async () => {
    // Given
    const driver = createNullRedisDriver();

    // When / Then
    expect(await driver.get('k')).toBeNull();
    expect(await driver.exists('k')).toBe(0);
    expect(await driver.mget('a', 'b')).toEqual([null, null]);
    expect(await driver.smembers('t')).toEqual([]);
    expect(await driver.ttl('k')).toBe(-2);
    expect(await driver.set('k', 'v')).toBeNull();
    expect(await driver.setex('k', 10, 'v')).toBe('OK');
    expect(await driver.del('k')).toBe(0);
    expect(await driver.scriptLoad('return 1')).toBe('');
  });

  it('provides a no-op pipeline that returns an empty result', async () => {
    // Given
    const driver = createNullRedisDriver();

    // When
    const pipeline = driver.pipeline();
    const result = await pipeline.del('x').set('y', 'z').exec();

    // Then
    expect(result).toEqual([]);
  });

  it('makes event wiring and command hooks no-ops', () => {
    // Given
    const driver = createNullRedisDriver();

    // When / Then — none of these throw
    expect(() => {
      const handler = (): void => undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      driver.on('connect' as any, handler);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      driver.off('connect' as any, handler);
      driver.setCommandHook?.(null);
    }).not.toThrow();
  });

  it('degrades unknown/long-tail commands to a benign null', async () => {
    // Given
    const driver = createNullRedisDriver();

    // When / Then
    expect(await driver.hget('h', 'f')).toBeNull();
    expect(await driver.zadd('z', 1, 'm')).toBeNull();
  });

  it('is not thenable (safe under an accidental await)', async () => {
    // Given
    const driver = createNullRedisDriver();

    // When / Then — awaiting a non-thenable yields the object itself
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((driver as any).then).toBeUndefined();
    expect(await driver).toBe(driver);
  });
});
