import { vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';

/**
 * Creates a mocked IRedisDriver limited to the commands the session store uses.
 *
 * `scriptLoad` resolves to a symbolic sha derived from the script's marker
 * comment (`-- session:<name>`), so tests can route `evalsha` behavior per
 * script without depending on script content.
 */
export function createMockDriver(): MockedObject<IRedisDriver> {
  return {
    scriptLoad: vi.fn(async (script: string) => {
      const match = /-- session:([\w-]+)/.exec(script);
      return match ? `sha:${match[1]}` : 'sha:unknown';
    }),
    eval: vi.fn().mockResolvedValue(null),
    evalsha: vi.fn().mockResolvedValue(null),
    zadd: vi.fn().mockResolvedValue(1),
    zrem: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    hgetall: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as MockedObject<IRedisDriver>;
}

/**
 * Convenience: route evalsha calls by symbolic sha (see createMockDriver).
 * Later registrations override earlier ones for the same script name.
 */
export function routeEvalsha(driver: MockedObject<IRedisDriver>, routes: Record<string, (keys: string[], args: Array<string | number>) => unknown>): void {
  driver.evalsha.mockImplementation(async (sha: string, keys: string[], args: Array<string | number>) => {
    const name = sha.replace(/^sha:/, '');
    const route = routes[name];
    if (!route) {
      throw new Error(`Unexpected evalsha for script "${name}"`);
    }
    return route(keys, args);
  });
}
