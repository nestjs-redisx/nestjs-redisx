/**
 * @LeaderOnly decorator — run a method only on the elected leader instance.
 *
 * Uses immediate proxy-based wrapping (etalon: @WithLock), so it works on ANY
 * @Injectable class method. Composes naturally with @nestjs/schedule: @Cron
 * fires on every instance, the decorated body runs only where the lease is
 * held.
 *
 * Fail-safe skip: when the plugin (and therefore the leader service) is not
 * available, the method is SKIPPED — for singleton work "nobody runs" is
 * recoverable, "everybody runs" is not.
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { DEFAULT_LEADER_GROUP } from '../../../shared/constants';
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

// Global service getter for lazy injection (registered by LeaderPlugin's
// initializer once the DI container is up).
let globalLeaderServiceGetter: (() => IDecoratorLeaderService) | null = null;
let warnedNoService = false;

/**
 * Register the leader service getter for lazy injection.
 * Called by LeaderDecoratorInitializerService during initialization.
 */
export function registerLeaderServiceGetter(getter: (() => IDecoratorLeaderService) | null): void {
  globalLeaderServiceGetter = getter;
  if (getter) {
    warnedNoService = false;
  }
}

// Groups referenced by decorators register here at decoration time (class
// load — BEFORE bootstrap), so the service can start their elections in
// onModuleInit and `isLeader` is meaningful by the first cron tick.
const registeredGroups = new Set<string>();

/** Register an election group (used by @LeaderOnly at decoration time). */
export function registerLeaderGroup(group: string): void {
  validateLeaderGroup(group, '@LeaderOnly');
  registeredGroups.add(group);
}

/** Groups registered by decorators (read by LeaderService at bootstrap). */
export function getRegisteredLeaderGroups(): ReadonlySet<string> {
  return registeredGroups;
}

/** Test aid: reset the decoration-time group registry. */
export function clearRegisteredLeaderGroups(): void {
  registeredGroups.clear();
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
  const group = options.group ?? DEFAULT_LEADER_GROUP;
  registerLeaderGroup(group);

  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      if (!globalLeaderServiceGetter) {
        if (!warnedNoService) {
          warnedNoService = true;
          logger.warn('@LeaderOnly: LeaderService is not available (is LeaderPlugin registered?). Skipping the method on this instance — no instance will run it until the plugin initializes.');
        }
        return undefined;
      }

      const leaderService = globalLeaderServiceGetter();
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

    // Store metadata on the WRAPPER function for reflection
    Reflect.defineMetadata(LEADER_ONLY_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}
