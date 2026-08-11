/**
 * Null-object {@link IRedisDriver} for `mode: 'l1-only'`.
 *
 * In l1-only the cache runs with NO Redis. The L2 store, tag index and (in
 * l1-only) the stampede layer are swapped for in-memory implementations that
 * never touch a driver, so this object exists only to satisfy the remaining
 * `CACHE_REDIS_DRIVER` injections (CacheService, EventInvalidationService)
 * WITHOUT ever opening a connection — which is what fixes the boot crash.
 *
 * It never connects and every command degrades to a benign miss / no-op, so an
 * accidentally-reachable path (e.g. the fail-open event-dedup check) behaves as
 * "nothing cached" rather than throwing.
 */

/* eslint-disable @typescript-eslint/require-await -- null object: every method is an intentional no-op/miss stub, no real awaiting */
import { IRedisDriver, IMulti } from '@nestjs-redisx/core';

/** A no-op pipeline/multi: every queued command is dropped, `exec()` is empty. */
function createNoopPipeline(): IMulti {
  const proxy = new Proxy({} as IMulti, {
    get(_target, prop: string | symbol) {
      if (prop === 'exec') {
        return async (): Promise<Array<[Error | null, unknown]>> => [];
      }
      if (prop === 'discard') {
        return (): void => undefined;
      }
      // Any chained command (`.del(...)`, `.set(...)`, …) is a no-op that
      // returns the pipeline itself for further chaining.
      return () => proxy;
    },
  });
  return proxy;
}

/**
 * Explicit, correctly-typed no-op implementations for the handful of commands
 * that can be reached in l1-only, plus lifecycle/event methods. Everything else
 * falls through to a benign async `null` via the Proxy below.
 */
const NULL_DRIVER_METHODS: Partial<Record<keyof IRedisDriver, unknown>> = {
  // Connection lifecycle — never actually connects.
  isConnected: () => false,
  connect: async () => undefined,
  disconnect: async () => undefined,
  select: async () => undefined,
  ping: async (message?: string) => message ?? 'PONG',

  // Event wiring is a no-op (no underlying client to listen to).
  on: () => undefined,
  once: () => undefined,
  off: () => undefined,
  removeAllListeners: () => undefined,
  setCommandHook: () => undefined,

  // Batching.
  pipeline: () => createNoopPipeline(),
  multi: () => createNoopPipeline(),

  // Reads → miss.
  get: async () => null,
  mget: async (...keys: string[]) => keys.map(() => null),
  exists: async () => 0,
  smembers: async () => [],
  scard: async () => 0,
  keys: async () => [],
  scan: async (): Promise<[string, string[]]> => ['0', []],
  ttl: async () => -2,

  // Writes → benign success/no-op.
  set: async () => null,
  setex: async () => 'OK',
  del: async () => 0,
  sadd: async () => 0,
  srem: async () => 0,
  expire: async () => 0,
  eval: async () => null,
  evalsha: async () => null,
  scriptLoad: async () => '',
};

/**
 * Creates a null Redis driver for l1-only mode.
 */
export function createNullRedisDriver(): IRedisDriver {
  return new Proxy(NULL_DRIVER_METHODS as unknown as IRedisDriver, {
    get(target, prop: string | symbol) {
      if (prop in target) {
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      }
      // Guard against being treated as a thenable if someone `await`s it.
      if (prop === 'then') {
        return undefined;
      }
      // Long-tail Redis commands are unreachable in l1-only; degrade to a
      // benign async null rather than crash if one is ever called.
      return async () => null;
    },
  });
}
