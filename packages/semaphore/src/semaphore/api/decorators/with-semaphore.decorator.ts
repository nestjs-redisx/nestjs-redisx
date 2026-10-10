/**
 * @WithSemaphore decorator - bound concurrency for a method across instances.
 *
 * Uses immediate proxy-based wrapping (etalon: @WithLock), so it works on ANY
 * @Injectable class method. At most `permits` concurrent executions of the
 * decorated method run across the whole fleet.
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { SemaphoreAcquisitionError } from '../../../shared/errors';

const logger = new Logger('WithSemaphore');

/**
 * Metadata key for @WithSemaphore decorator options (set on the wrapper).
 */
export const WITH_SEMAPHORE_OPTIONS = Symbol.for('WITH_SEMAPHORE_OPTIONS');

/**
 * Permit interface for decorator use.
 */
interface IDecoratorPermit {
  release(): Promise<void>;
}

/**
 * Semaphore service slice the decorator needs.
 */
interface IDecoratorSemaphoreService {
  acquire(
    key: string,
    permits: number,
    options?: {
      ttl?: number;
      waitTimeout?: number;
      autoRenew?: boolean;
    },
  ): Promise<IDecoratorPermit>;
}

// Global service getter for lazy injection. On `globalThis` under a
// `Symbol.for` key: with the dual CJS + ESM build a process can load both
// copies of this module, and module-scoped state would split between them.
const SERVICE_GETTER_KEY = Symbol.for('nestjs-redisx.semaphore.service-getter');

function getterSlot(): { current: (() => IDecoratorSemaphoreService) | null } {
  const slot = globalThis as Record<symbol, unknown>;
  let holder = slot[SERVICE_GETTER_KEY] as { current: (() => IDecoratorSemaphoreService) | null } | undefined;
  if (!holder) {
    holder = { current: null };
    slot[SERVICE_GETTER_KEY] = holder;
  }
  return holder;
}

/**
 * Registers the semaphore service getter for lazy injection.
 * Called by SemaphorePlugin during initialization; null resets (test aid).
 */
export function registerSemaphoreServiceGetter(getter: (() => IDecoratorSemaphoreService) | null): void {
  getterSlot().current = getter;
}

/**
 * Options for @WithSemaphore.
 */
export interface IWithSemaphoreOptions {
  /**
   * Semaphore key or key builder function.
   *
   * @example
   * ```typescript
   * @WithSemaphore({ key: 'render:{0}', permits: 4 })      // first argument
   * @WithSemaphore({ key: (dto) => `tenant:${dto.id}`, permits: 2 })
   * ```
   */
  key: string | ((...args: unknown[]) => string);

  /**
   * Semaphore capacity: the maximum number of concurrent executions across
   * all instances. Must be the same on every decorator using this key.
   */
  permits: number;

  /**
   * Permit TTL in milliseconds.
   */
  ttl?: number;

  /**
   * Maximum time to wait for a permit in milliseconds.
   */
  waitTimeout?: number;

  /**
   * Enable auto-renewal for the held permit.
   */
  autoRenew?: boolean;

  /**
   * Action when no permit could be acquired.
   * - 'throw': throw SemaphoreAcquisitionError (default)
   * - 'skip': skip the method and resolve to undefined
   * - function: throw the returned custom error
   */
  onUnavailable?: 'throw' | 'skip' | ((key: string) => Error);
}

/**
 * Bounds concurrent executions of the decorated method across the fleet.
 *
 * Acquires a semaphore permit before the method runs and always releases it
 * afterwards. Without the plugin registered, the method executes WITHOUT the
 * bound (with a warning) - a missing ceiling is observable and recoverable,
 * a silently skipped business method is not.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class ReportService {
 *   // At most 3 renders at a time across every instance
 *   @WithSemaphore({ key: 'reports:render', permits: 3, ttl: 120000 })
 *   async render(id: string) { ... }
 *
 *   // Per-tenant bound, skip when saturated
 *   @WithSemaphore({
 *     key: (tenantId) => `export:${tenantId}`,
 *     permits: 1,
 *     onUnavailable: 'skip',
 *   })
 *   async export(tenantId: string) { ... }
 * }
 * ```
 */
export function WithSemaphore(options: IWithSemaphoreOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const getter = getterSlot().current;
      if (!getter) {
        logger.warn('@WithSemaphore: SemaphoreService not yet available, executing method without a concurrency bound');
        return originalMethod.apply(this, args);
      }

      const semaphoreService = getter();
      if (!semaphoreService) {
        logger.warn('@WithSemaphore: SemaphoreService getter returned null, executing method without a concurrency bound');
        return originalMethod.apply(this, args);
      }

      const key = buildSemaphoreKey(args, options);
      let permit: IDecoratorPermit | null = null;

      try {
        permit = await semaphoreService.acquire(key, options.permits, {
          ttl: options.ttl,
          waitTimeout: options.waitTimeout,
          autoRenew: options.autoRenew,
        });

        return await originalMethod.apply(this, args);
      } catch (error) {
        if (isAcquisitionFailure(error) && !permit) {
          return handleUnavailable(key, options, error);
        }
        throw error;
      } finally {
        if (permit) {
          await permit.release().catch((err: Error) => {
            logger.error(`@WithSemaphore: Failed to release permit on ${key}:`, err);
          });
        }
      }
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Carry over metadata stamped by decorators applied BEFORE this one
    // (written below @WithSemaphore in source order - e.g. @Cron).
    // Discovery-based consumers (the scheduler among them) read metadata off
    // the prototype's method, which is now the wrapper; without the copy,
    // `@WithSemaphore` above `@Cron()` silently unregisters the job on every
    // instance.
    for (const metadataKey of Reflect.getOwnMetadataKeys(originalMethod)) {
      Reflect.defineMetadata(metadataKey, Reflect.getOwnMetadata(metadataKey, originalMethod), descriptor.value);
    }

    // Store metadata on the WRAPPER function for reflection
    Reflect.defineMetadata(WITH_SEMAPHORE_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Builds the semaphore key from a template or function.
 * `{n}` placeholders interpolate the n-th argument (stringified).
 */
const warnedObjectTemplates = new WeakSet<object>();

function buildSemaphoreKey(args: unknown[], options: IWithSemaphoreOptions): string {
  if (typeof options.key === 'function') {
    return options.key(...args);
  }
  return options.key.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = args[Number(index)];
    if (value === undefined || value === null) {
      return '';
    }
    const rendered = String(value);
    if (rendered === '[object Object]' && !warnedObjectTemplates.has(options)) {
      // Every call collapses onto ONE key - all tenants silently share one
      // semaphore. Loud once per decorator site.
      warnedObjectTemplates.add(options);
      logger.warn(`@WithSemaphore: key template "${options.key as string}" interpolated an object as "[object Object]" - every call shares ONE semaphore key. Interpolate a scalar id or use a key builder function.`);
    }
    return rendered;
  });
}

/**
 * Cross-copy-safe acquisition-failure detection: with the dual CJS + ESM
 * build the SERVICE may have been loaded from the other module copy, so its
 * SemaphoreAcquisitionError is a DIFFERENT class and `instanceof` alone
 * fails - the onUnavailable policy would silently die. The error code is
 * copy-independent.
 */
function isAcquisitionFailure(error: unknown): error is SemaphoreAcquisitionError {
  if (error instanceof SemaphoreAcquisitionError) {
    return true;
  }
  const code = (error as { code?: string } | null)?.code;
  return code === 'SEMAPHORE_ACQUISITION_TIMEOUT' || code === 'SEMAPHORE_ACQUISITION_FAILED';
}

/**
 * Applies the configured onUnavailable policy. Total: a user policy
 * function returning a non-Error (or nothing) must not surface as
 * `throw undefined` - the original acquisition error is thrown instead.
 */
function handleUnavailable(key: string, options: IWithSemaphoreOptions, error: unknown): undefined {
  const policy = options.onUnavailable ?? 'throw';

  if (policy === 'skip') {
    logger.debug(`@WithSemaphore: no permit available on "${key}", skipping method`);
    return undefined;
  }

  if (typeof policy === 'function') {
    let custom: unknown;
    try {
      custom = policy(key);
    } catch (policyError) {
      custom = policyError;
    }
    throw custom instanceof Error ? custom : error;
  }

  throw error;
}
