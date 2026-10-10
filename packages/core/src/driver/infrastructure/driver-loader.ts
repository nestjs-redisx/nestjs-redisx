import { createRequire } from 'node:module';

import { RedisXError, ErrorCode } from '../../errors';

/**
 * Lazy loading of the optional driver libraries (`ioredis`, `redis`).
 *
 * Both packages are optional: users install only the driver they configure.
 * The adapters therefore must not reference them via static `import` - in the
 * ESM build a static import is resolved by Node BEFORE any code runs, so a
 * missing optional package would crash every consumer at startup. Loading via
 * `createRequire` keeps resolution lazy AND synchronous (both driver
 * libraries are CommonJS), so `createDriver()` stays a plain sync factory.
 *
 * Anchored to `__filename` (NOT `import.meta.url`, which the CommonJS
 * `module` setting of this codebase rejects at typecheck): native in the CJS
 * bundle and under Vitest, and polyfilled from `import.meta.url` by the tsup
 * `shims` option in the ESM bundle - resolution always starts next to this
 * file, exactly like a regular `require` would.
 */
const requireDriver = createRequire(__filename);

type IoredisModule = typeof import('ioredis');
type NodeRedisModule = typeof import('redis');

/** Value shape of the `ioredis` package used by {@link IoRedisAdapter}. */
export interface IIoredisLib {
  Redis: IoredisModule['Redis'];
  Cluster: IoredisModule['Cluster'];
}

/** Value shape of the `redis` package used by {@link NodeRedisAdapter}. */
export interface INodeRedisLib {
  createClient: NodeRedisModule['createClient'];
  createCluster: NodeRedisModule['createCluster'];
  createSentinel: NodeRedisModule['createSentinel'];
}

/**
 * True only for "the package itself is not installed" - a package that IS
 * installed but fails to load (broken install, its own missing dependency)
 * must surface its original error instead of a misleading "not installed".
 */
function isModuleNotFound(error: unknown, pkg: string): boolean {
  const code = (error as { code?: string }).code;
  return (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') && String((error as Error).message).includes(pkg);
}

function missingDriverError(pkg: string, driverType: string): RedisXError {
  return new RedisXError(`The "${pkg}" package is required by driver type "${driverType}" but is not installed. Install it (npm install ${pkg}) or configure a different driver via the "driverType" option.`, ErrorCode.CFG_DRIVER_NOT_SUPPORTED, undefined, { driverType, package: pkg });
}

// `null` = confirmed not installed; `undefined` = not probed yet. A load
// failure other than "not installed" is NOT cached - it rethrows on every
// call so the original error stays visible.
let ioredisLib: IIoredisLib | null | undefined;
let nodeRedisLib: INodeRedisLib | null | undefined;

/**
 * Loads `ioredis`, or throws a clear {@link RedisXError} when it is not
 * installed (previously a missing driver surfaced as a cryptic
 * "Redis is not a constructor" TypeError from the patched bundle).
 */
export function loadIoredis(): IIoredisLib {
  if (ioredisLib === undefined) {
    try {
      // CJS shape: module.exports IS the Redis class, carrying `.Redis`,
      // `.Cluster` and `.default` as properties. Normalize defensively so a
      // future ESM-ified ioredis keeps working.
      const mod = requireDriver('ioredis') as { Redis?: IIoredisLib['Redis']; Cluster?: IIoredisLib['Cluster']; default?: IIoredisLib['Redis'] };
      const redisCtor = mod.Redis ?? mod.default ?? (mod as unknown as IIoredisLib['Redis']);
      ioredisLib = { Redis: redisCtor, Cluster: mod.Cluster ?? (redisCtor as unknown as { Cluster: IIoredisLib['Cluster'] }).Cluster };
    } catch (error) {
      if (!isModuleNotFound(error, 'ioredis')) {
        throw error;
      }
      ioredisLib = null;
    }
  }
  if (!ioredisLib) {
    throw missingDriverError('ioredis', 'ioredis');
  }
  return ioredisLib;
}

/**
 * Loads `redis` (node-redis), or throws a clear {@link RedisXError} when it
 * is not installed.
 */
export function loadNodeRedis(): INodeRedisLib {
  if (nodeRedisLib === undefined) {
    try {
      const mod = requireDriver('redis') as INodeRedisLib;
      nodeRedisLib = { createClient: mod.createClient, createCluster: mod.createCluster, createSentinel: mod.createSentinel };
    } catch (error) {
      if (!isModuleNotFound(error, 'redis')) {
        throw error;
      }
      nodeRedisLib = null;
    }
  }
  if (!nodeRedisLib) {
    throw missingDriverError('redis', 'node-redis');
  }
  return nodeRedisLib;
}

/**
 * Resolvability probe for {@link detectAvailableDriver} - never loads the
 * package, never throws.
 */
export function isDriverPackageInstalled(pkg: 'ioredis' | 'redis'): boolean {
  try {
    requireDriver.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}
