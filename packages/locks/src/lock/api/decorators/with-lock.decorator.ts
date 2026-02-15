/**
 * @WithLock decorator for distributed locking.
 *
 * Uses immediate proxy-based wrapping (not deferred to interceptor).
 * Works on ANY Injectable class methods (services, repositories, etc).
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { LockAcquisitionError } from '../../../shared/errors';

const logger = new Logger('WithLock');

/**
 * Metadata key for @WithLock decorator options.
 */
export const WITH_LOCK_OPTIONS = Symbol.for('WITH_LOCK_OPTIONS');

/**
 * Lock interface for decorator use.
 */
interface IDecoratorLock {
  release(): Promise<void>;
}

/**
 * Lock service interface for decorator use.
 */
interface IDecoratorLockService {
  acquire(
    key: string,
    options?: {
      ttl?: number;
      waitTimeout?: number;
      autoRenew?: boolean;
    },
  ): Promise<IDecoratorLock>;
}

// Global service getter for lazy injection
let globalLockServiceGetter: (() => IDecoratorLockService) | null = null;

/**
 * Register lock service getter for lazy injection.
 * Called by LocksPlugin during initialization.
 */
export function registerLockServiceGetter(getter: () => IDecoratorLockService): void {
  globalLockServiceGetter = getter;
}

/**
 * Options for @WithLock decorator.
 */
export interface IWithLockOptions {
  /**
   * Lock key or key builder function.
   *
   * @example
   * ```typescript
   * @WithLock({ key: 'update-user:{0}' }) // Uses first argument
   * @WithLock({ key: (dto) => `order:${dto.id}` }) // Custom function
   * ```
   */
  key: string | ((...args: unknown[]) => string);

  /**
   * Lock TTL in milliseconds.
   */
  ttl?: number;

  /**
   * Maximum time to wait for lock acquisition in milliseconds.
   */
  waitTimeout?: number;

  /**
   * Enable auto-renewal.
   */
  autoRenew?: boolean;

  /**
   * Action to take if lock acquisition fails.
   * - 'throw': Throw LockAcquisitionError (default)
   * - 'skip': Skip method execution and return undefined
   * - function: Throw custom error
   */
  onLockFailed?: 'throw' | 'skip' | ((key: string) => Error);
}

/**
 * Decorator for distributed locking.
 *
 * Acquires a distributed lock before executing the method
 * and automatically releases it afterwards.
 *
 * Works on any Injectable class method, not just controllers.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class OrderService {
 *   @WithLock({ key: 'order:{0}' })
 *   async processOrder(orderId: string) {
 *     // Only one instance processes this order at a time
 *   }
 *
 *   @WithLock({
 *     key: (dto) => `customer:${dto.customerId}`,
 *     ttl: 60000,
 *     autoRenew: true,
 *   })
 *   async createOrder(dto: CreateOrderDto) {
 *     // Lock by customer ID with auto-renewal
 *   }
 *
 *   @WithLock({
 *     key: 'sync:inventory',
 *     onLockFailed: 'skip',
 *   })
 *   async syncInventory() {
 *     // Will skip if already syncing
 *   }
 * }
 * ```
 */
export function WithLock(options: IWithLockOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    // Replace method with locking proxy
    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      // Lazy inject lock service on first call
      if (!globalLockServiceGetter) {
        logger.warn(`@WithLock: LockService not yet available, executing method without lock`);
        return originalMethod.apply(this, args);
      }

      const lockService = globalLockServiceGetter();
      if (!lockService) {
        logger.warn(`@WithLock: LockService getter returned null, executing method without lock`);
        return originalMethod.apply(this, args);
      }

      // Build lock key
      const key = buildLockKey(args, options);
      let lock: IDecoratorLock | null = null;

      try {
        // Acquire lock
        lock = await lockService.acquire(key, {
          ttl: options.ttl,
          waitTimeout: options.waitTimeout,
          autoRenew: options.autoRenew,
        });

        // Execute original method
        const result = await originalMethod.apply(this, args);

        return result;
      } catch (error) {
        // Handle lock acquisition failure
        if (error instanceof LockAcquisitionError) {
          return handleLockFailed(key, options, error);
        }
        throw error;
      } finally {
        // Always release lock
        if (lock) {
          await lock.release().catch((err: Error) => {
            logger.error(`@WithLock: Failed to release lock ${key}:`, err);
          });
        }
      }
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Store metadata on WRAPPER function for reflection (after replacement)
    Reflect.defineMetadata(WITH_LOCK_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Builds lock key from template or function.
 */
function buildLockKey(args: unknown[], options: IWithLockOptions): string {
  if (typeof options.key === 'function') {
    return options.key(...args);
  }
  return interpolateKey(options.key, args);
}

/**
 * Interpolates key template with arguments.
 *
 * Supports:
 * - {0}, {1}, etc. for positional arguments
 * - {0.id}, {1.name}, etc. for object properties
 */
function interpolateKey(template: string, args: unknown[]): string {
  return template.replace(/\{(\d+)(?:\.(\w+))?\}/g, (_, index, prop) => {
    const arg = args[Number(index)];
    if (prop && typeof arg === 'object' && arg !== null) {
      return String((arg as Record<string, unknown>)[prop]);
    }
    return String(arg);
  });
}

/**
 * Handles lock acquisition failure.
 */
function handleLockFailed(key: string, options: IWithLockOptions, error: LockAcquisitionError): undefined {
  const handler = options.onLockFailed ?? 'throw';

  if (handler === 'throw') {
    throw error;
  }

  if (handler === 'skip') {
    return undefined;
  }

  if (typeof handler === 'function') {
    throw handler(key);
  }

  throw error;
}
