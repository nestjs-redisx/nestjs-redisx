/**
 * @LeaderOnly decorator - run a method only on the elected leader instance.
 *
 * Uses immediate proxy-based wrapping (etalon: @WithLock), so it works on ANY
 * @Injectable class method. Composes naturally with @nestjs/schedule: @Cron
 * fires on every instance, the decorated body runs only where the lease is
 * held.
 *
 * Fail-safe skip: when the plugin (and therefore the leader service) is not
 * available, the method is SKIPPED - for singleton work "nobody runs" is
 * recoverable, "everybody runs" is not.
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { DEFAULT_LEADER_GROUP } from '../../../shared/constants';
import { InvalidLeaderConfigError } from '../../../shared/errors';
import { validateLeaderGroup } from '../../../shared/utils/validate-leader-options';

const logger = new Logger('LeaderOnly');

/**
 * Metadata key for @LeaderOnly decorator options (set on the wrapper).
 */
export const LEADER_ONLY_OPTIONS = Symbol.for('LEADER_ONLY_OPTIONS');

/**
 * The slice of the leader service the decorator needs.
 */
interface IDecoratorLeaderService {
  isLeader(group?: string): boolean;
}

// Service getters for lazy injection, in registration order (registered by
// each LeaderPlugin's initializer once its DI container is up). A LIST, not
// a single slot: with two Nest apps in one process (tests, modular
// monoliths) the slot design wedged the survivor - whichever app closed
// removed the only getter, and the app still running skipped every
// decorated method forever. Decorated methods consult the most recently
// registered LIVE service; closing any app re-exposes the previous one.
//
// Both decorator registries (getters + groups) live on `globalThis` under
// `Symbol.for` keys, NOT in module scope: with the dual CJS + ESM build a
// process can load BOTH copies of this module (e.g. an ESM application plus
// a CJS dependency that requires the package). Module-scoped state would
// split - decorators applied through one copy would register groups and
// consult getters invisible to the service wired through the other, so every
// decorated method would skip fail-safe with zero signal.
const SERVICE_GETTERS_KEY = Symbol.for('nestjs-redisx.leader.service-getters');
const DECORATOR_GROUPS_KEY = Symbol.for('nestjs-redisx.leader.decorator-groups');

function globalSlot<T>(key: symbol, create: () => T): T {
  const slot = globalThis as Record<symbol, unknown>;
  let value = slot[key] as T | undefined;
  if (value === undefined) {
    value = create();
    slot[key] = value;
  }
  return value;
}

function leaderServiceGetters(): Array<() => IDecoratorLeaderService> {
  return globalSlot(SERVICE_GETTERS_KEY, () => []);
}

let warnedNoService = false;

/**
 * Register the leader service getter for lazy injection.
 * Called by LeaderDecoratorInitializerService during initialization.
 * Passing null clears the whole registry (test aid / legacy reset).
 */
export function registerLeaderServiceGetter(getter: (() => IDecoratorLeaderService) | null): void {
  const getters = leaderServiceGetters();
  if (getter === null) {
    getters.length = 0;
    return;
  }
  if (!getters.includes(getter)) {
    getters.push(getter);
  }
  warnedNoService = false;
  if (getters.length > 1) {
    // Which app SHOULD gate a decorated method is ambiguous in this
    // topology (the decorator is bound to a class, not an app) - make the
    // arbitration rule loud instead of silent.
    logger.warn(`@LeaderOnly: ${getters.length} leader services are registered in this process (multiple Nest apps?). ` + `Decorated methods consult the most recently initialized one; leadership is NOT evaluated per app.`);
  }
}

/**
 * Unregister a previously registered getter - identity-based, so a closing
 * application removes exactly its own entry and any remaining app's getter
 * becomes active again. After the LAST unregistration, decorated methods
 * skip fail-safe instead of consulting a destroyed service.
 */
export function unregisterLeaderServiceGetter(getter: () => IDecoratorLeaderService): void {
  const getters = leaderServiceGetters();
  const index = getters.lastIndexOf(getter);
  if (index !== -1) {
    getters.splice(index, 1);
  }
}

// Groups referenced by decorators register here at decoration time (class
// load - BEFORE bootstrap), so the service can start their elections in
// onModuleInit and `isLeader` is meaningful by the first cron tick.
// On `globalThis` for the same dual-copy reason as the getters above.
function registeredGroups(): Set<string> {
  return globalSlot(DECORATOR_GROUPS_KEY, () => new Set<string>());
}

/** Register an election group (used by @LeaderOnly at decoration time). */
export function registerLeaderGroup(group: string): void {
  validateLeaderGroup(group, '@LeaderOnly');
  registeredGroups().add(group);
}

/** Groups registered by decorators (read by LeaderService at bootstrap). */
export function getRegisteredLeaderGroups(): ReadonlySet<string> {
  return registeredGroups();
}

/** Test aid: reset the decoration-time group registry. */
export function clearRegisteredLeaderGroups(): void {
  registeredGroups().clear();
}

/**
 * Options for @LeaderOnly.
 */
export interface ILeaderOnlyOptions {
  /**
   * Election group whose leadership gates this method.
   * @default 'default'
   */
  group?: string;
}

/**
 * Run the decorated method only when THIS instance is the leader; otherwise
 * skip it and resolve to undefined.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class ReportJobs {
 *   @Cron(CronExpression.EVERY_HOUR)
 *   @LeaderOnly()
 *   async hourlyReport() {
 *     // Runs on exactly one instance of the fleet
 *   }
 *
 *   @Cron(CronExpression.EVERY_5_MINUTES)
 *   @LeaderOnly({ group: 'cleanup' })
 *   async cleanupExpired() {}
 * }
 * ```
 */
export function LeaderOnly(options: ILeaderOnlyOptions = {}): MethodDecorator {
  if (arguments.length >= 3) {
    // Bare `@LeaderOnly` (no parentheses) invokes the FACTORY as the
    // decorator with (prototype, key, descriptor); the returned inner
    // function would then be treated as an empty descriptor and the method
    // would silently stay UNGATED - running on every instance, the one
    // unrecoverable failure. Unreachable from TypeScript (TS1329); real in
    // plain-JS/Babel apps.
    throw new InvalidLeaderConfigError('@LeaderOnly must be CALLED: use @LeaderOnly() or @LeaderOnly({ group }), not bare @LeaderOnly.');
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    // Fail fast at class load with a tagged error: `@LeaderOnly(null)`
    // would otherwise crash with a bare TypeError, and a positional string
    // or array - `@LeaderOnly('cleanup')` / `@LeaderOnly(['cleanup'])`,
    // plausible since the sibling APIs take the group positionally - would
    // be SILENTLY accepted and gate the 'default' group instead of the
    // intended one.
    throw new InvalidLeaderConfigError(`@LeaderOnly: options must be an object, got ${options === null ? 'null' : Array.isArray(options) ? 'array' : typeof options}. Did you mean @LeaderOnly({ group: ... })?`);
  }
  if (typeof (options as { then?: unknown }).then === 'function') {
    // A native Promise (`@LeaderOnly(loadOptions())` with an async helper)
    // has zero own enumerable keys: it slips past the unknown-keys net
    // below and silently gates 'default' instead of the intended group -
    // the same mis-gating class as the positional-string/array shapes.
    // Plain-JS only; TypeScript rejects the shape at compile time.
    throw new InvalidLeaderConfigError('@LeaderOnly: options must be a plain object, got a thenable (Promise). A decorator argument cannot be awaited - resolve the config before class definition and pass a literal { group }.');
  }
  if (options.group === undefined || options.group === null) {
    // With no group NAMED (undefined or null - both coalesce to 'default'
    // below), an unknown key is almost certainly a typo: { groups:
    // 'cleanup' } would silently gate 'default'. Extra keys ALONGSIDE a
    // valid group cannot change which group is gated, so a widened config
    // object ({ group: 'reports', timeoutMs: 5000 }, legal under
    // structural typing) stays accepted.
    const unknownKeys = Object.keys(options).filter((key) => key !== 'group');
    if (unknownKeys.length > 0) {
      throw new InvalidLeaderConfigError(`@LeaderOnly: unknown option(s) ${unknownKeys.map((key) => `"${key}"`).join(', ')} and no "group" - the only supported option is "group".`);
    }
  }
  const group = options.group ?? DEFAULT_LEADER_GROUP;
  registerLeaderGroup(group);

  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    if (typeof descriptor?.value !== 'function') {
      // Fail fast at class load with a real error instead of a cryptic
      // TypeError: on a getter/setter or property there is no method to gate,
      // and silently skipping would run the body on EVERY instance.
      throw new InvalidLeaderConfigError(`@LeaderOnly can only decorate methods; "${String(_propertyKey)}" is not a method (getters, setters, and properties are not supported).`);
    }
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    const methodTag = Object.prototype.toString.call(originalMethod);
    if (methodTag === '[object GeneratorFunction]' || methodTag === '[object AsyncGeneratorFunction]') {
      // The async gate wrapper cannot preserve generator semantics: callers
      // iterate the returned (async) iterator, but a gated follower would
      // hand them `undefined` and a leader a Promise OF an iterator - a
      // cryptic TypeError either way, on every path. Fail fast at class
      // load, like the non-method guard above.
      throw new InvalidLeaderConfigError(`@LeaderOnly cannot decorate generator methods; "${String(_propertyKey)}" is a ${methodTag.slice(8, -1)}. ` + `Gate the generator's CALLER with isLeader()/runIfLeader() instead.`);
    }

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const getters = leaderServiceGetters();
      const activeGetter = getters[getters.length - 1];
      if (!activeGetter) {
        if (!warnedNoService) {
          warnedNoService = true;
          logger.warn('@LeaderOnly: LeaderService is not available (is LeaderPlugin registered?). Skipping the method on this instance - no instance will run it until the plugin initializes.');
        }
        return undefined;
      }

      const leaderService = activeGetter();
      if (!leaderService?.isLeader(group)) {
        return undefined;
      }

      return originalMethod.apply(this, args);
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Carry over metadata stamped by decorators applied BEFORE this one
    // (written below @LeaderOnly in source order - e.g. @Cron). The scheduler
    // discovers jobs by reading metadata off the prototype's method, which is
    // now the wrapper; without the copy, `@LeaderOnly()` above `@Cron()`
    // silently unregisters the job on every instance.
    for (const metadataKey of Reflect.getOwnMetadataKeys(originalMethod)) {
      Reflect.defineMetadata(metadataKey, Reflect.getOwnMetadata(metadataKey, originalMethod), descriptor.value);
    }

    // Store metadata on the WRAPPER function for reflection
    Reflect.defineMetadata(LEADER_ONLY_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}
