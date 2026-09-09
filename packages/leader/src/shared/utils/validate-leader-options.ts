import { DEFAULT_LEADER_CONFIG, MAX_LEADER_TTL_MS } from '../constants';
import { InvalidLeaderConfigError } from '../errors';
import { ILeaderPluginOptions } from '../types';

function describeValue(value: unknown): string {
  // The guard's own throw path must never replace or falsify the
  // source-tagged error: JSON.stringify throws on BigInt and on
  // circular/toJSON-throwing objects, and renders NaN/±Infinity as "null" —
  // which would send the operator hunting a null that never existed.
  if (typeof value === 'bigint') {
    return `${String(value)}n`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

function assertPositiveInt(value: number | undefined, name: string, source: string): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LEADER_TTL_MS) {
    throw new InvalidLeaderConfigError(`${source}: "${name}" must be a positive integer (ms, <= ${MAX_LEADER_TTL_MS}), got ${describeValue(value)}.`);
  }
}

/**
 * Validates a group name used in options, decorators, and per-call APIs.
 * Fail-fast: configuration mistakes are never swallowed by the election loop.
 */
export function validateLeaderGroup(group: unknown, source: string): void {
  if (typeof group !== 'string' || group.trim().length === 0) {
    throw new InvalidLeaderConfigError(`${source}: group must be a non-empty string, got ${describeValue(group)}.`);
  }
}

/**
 * Validates plugin options (sync AND async construction paths).
 */
export function validateLeaderOptions(options: ILeaderPluginOptions, source: string): void {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    // A registerAsync factory returning undefined (a missing config key is
    // the classic case), a JS caller passing null, or an accidentally
    // list-wrapped config (`[realConfig]` — every property read yields
    // undefined, so validation would silently pass with all-defaults) must
    // fail with a source-tagged error, not a bare TypeError or a silent
    // defaults boot.
    throw new InvalidLeaderConfigError(`${source}: options must be an object, got ${options === null ? 'null' : Array.isArray(options) ? 'array' : typeof options}.`);
  }
  if (typeof (options as { then?: unknown }).then === 'function') {
    // An un-awaited async config (`new LeaderPlugin(loadConfig())` with an
    // async loader) is a thenable with zero own enumerable keys: it passes
    // every per-key check and boots all-defaults — the same silent hazard
    // the array guard closes. The async path (registerAsync) awaits its
    // factory result before validating, so a thenable is never legitimate
    // here.
    throw new InvalidLeaderConfigError(`${source}: options must be a plain object, got a thenable (Promise). Await the config before passing it, or use LeaderPlugin.registerAsync().`);
  }
  assertPositiveInt(options.ttlMs, 'ttlMs', source);
  assertPositiveInt(options.renewIntervalMs, 'renewIntervalMs', source);
  assertPositiveInt(options.retryIntervalMs, 'retryIntervalMs', source);

  const effectiveTtl = options.ttlMs ?? DEFAULT_LEADER_CONFIG.ttlMs;
  const effectiveRenew = options.renewIntervalMs ?? DEFAULT_LEADER_CONFIG.renewIntervalMs;
  if (effectiveRenew >= effectiveTtl) {
    throw new InvalidLeaderConfigError(`${source}: "renewIntervalMs" (${effectiveRenew}) must be strictly less than "ttlMs" (${effectiveTtl}) — otherwise the lease expires before its own heartbeat.`);
  }

  if (options.groups !== undefined) {
    if (!Array.isArray(options.groups)) {
      throw new InvalidLeaderConfigError(`${source}: "groups" must be an array of non-empty strings.`);
    }
    for (const group of options.groups) {
      validateLeaderGroup(group, source);
    }
  }

  if (options.instanceId !== undefined && (typeof options.instanceId !== 'string' || options.instanceId.trim().length === 0)) {
    throw new InvalidLeaderConfigError(`${source}: "instanceId" must be a non-empty string when provided.`);
  }

  if (options.keyPrefix !== undefined && (typeof options.keyPrefix !== 'string' || options.keyPrefix.length === 0)) {
    throw new InvalidLeaderConfigError(`${source}: "keyPrefix" must be a non-empty string when provided (an empty prefix would make the election key a bare group name).`);
  }

  // Callbacks pair to start/stop singleton workers; a non-function here
  // would only surface as a contained warn on the winning pod — the
  // silent-worst-failure the fail-fast doctrine exists to prevent.
  if (options.onElected !== undefined && typeof options.onElected !== 'function') {
    throw new InvalidLeaderConfigError(`${source}: "onElected" must be a function when provided, got ${typeof options.onElected}.`);
  }
  if (options.onLost !== undefined && typeof options.onLost !== 'function') {
    throw new InvalidLeaderConfigError(`${source}: "onLost" must be a function when provided, got ${typeof options.onLost}.`);
  }
}
