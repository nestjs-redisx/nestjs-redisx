/**
 * @InvalidateOn decorator.
 * Automatically invalidates cache after method execution based on events.
 *
 * Uses immediate proxy-based wrapping (not deferred to interceptor).
 * Works on ANY Injectable class methods (services, repositories, etc).
 */

import 'reflect-metadata';
import { getCacheService } from '../../../cache/api/decorators/cached.decorator';

export const INVALIDATE_ON_OPTIONS = Symbol.for('INVALIDATE_ON_OPTIONS');

/**
 * Event invalidation service interface for decorator use.
 */
interface IDecoratorEventInvalidationService {
  emit(event: string, payload: unknown): Promise<void>;
}

// Global service registry for lazy injection (similar to getCacheService pattern)
let globalEventInvalidationServiceGetter: (() => IDecoratorEventInvalidationService) | null = null;

/**
 * Register event invalidation service getter for lazy injection.
 * Called by CacheDecoratorInitializerService during initialization.
 */
export function registerEventInvalidationServiceGetter(getter: () => IDecoratorEventInvalidationService): void {
  globalEventInvalidationServiceGetter = getter;
}

/**
 * Get the registered event invalidation service.
 */
export function getEventInvalidationService(): IDecoratorEventInvalidationService | null {
  return globalEventInvalidationServiceGetter ? globalEventInvalidationServiceGetter() : null;
}

export interface IInvalidateOnOptions {
  /** Events that trigger invalidation */
  events: string[];

  /** Tags to invalidate */
  tags?: string[] | ((result: unknown, args: unknown[]) => string[]);

  /** Keys to invalidate */
  keys?: string[] | ((result: unknown, args: unknown[]) => string[]);

  /** Condition - only invalidate if returns true */
  condition?: (result: unknown, args: unknown[]) => boolean;

  /** Publish event after method execution (for distributed invalidation) */
  publish?: boolean;
}

/**
 * Decorator that invalidates cache after method execution.
 *
 * Works on any Injectable class method, not just controllers.
 *
 * @param options - Invalidation options
 *
 * @example
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @InvalidateOn({
 *     events: ['user.updated'],
 *     tags: (result, [userId]) => [`user:${userId}`, 'users'],
 *   })
 *   async updateUser(userId: string, data: UpdateUserDto): Promise<User> {
 *     return this.userRepo.update(userId, data);
 *   }
 *
 *   @InvalidateOn({
 *     events: ['user.deleted'],
 *     keys: (result, [userId]) => [`user:${userId}`],
 *     tags: ['users'],
 *   })
 *   async deleteUser(userId: string): Promise<void> {
 *     await this.userRepo.delete(userId);
 *   }
 * }
 * ```
 */
export function InvalidateOn(options: IInvalidateOnOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    // Replace method with invalidation proxy
    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      // Execute original method first
      const result = await originalMethod.apply(this, args);

      // Get cache service for invalidation
      const cacheService = getCacheService();

      if (cacheService) {
        try {
          // Check condition
          if (options.condition && !options.condition(result, args)) {
            return result;
          }

          // Resolve tags
          const tags = resolveTags(options.tags, result, args);

          // Resolve keys
          const keys = resolveKeys(options.keys, result, args);

          // Perform invalidation
          if (tags.length > 0) {
            await cacheService.invalidateTags(tags);
          }

          if (keys.length > 0) {
            await cacheService.deleteMany(keys);
          }

          // Publish event for distributed invalidation
          if (options.publish) {
            const eventInvalidationService = getEventInvalidationService();
            if (eventInvalidationService) {
              // Emit events with result as payload for distributed invalidation
              for (const event of options.events) {
                await eventInvalidationService.emit(event, {
                  result,
                  args,
                  tags,
                  keys,
                  timestamp: Date.now(),
                });
              }
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('@InvalidateOn: Invalidation failed:', error);
          // Don't propagate error - method already succeeded
        }
      }

      return result;
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Store metadata on WRAPPER function for reflection (after replacement)
    Reflect.defineMetadata(INVALIDATE_ON_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Resolve tags from options.
 */
function resolveTags(tags: string[] | ((result: unknown, args: unknown[]) => string[]) | undefined, result: unknown, args: unknown[]): string[] {
  if (!tags) {
    return [];
  }

  if (typeof tags === 'function') {
    return tags(result, args);
  }

  return tags;
}

/**
 * Resolve keys from options.
 */
function resolveKeys(keys: string[] | ((result: unknown, args: unknown[]) => string[]) | undefined, result: unknown, args: unknown[]): string[] {
  if (!keys) {
    return [];
  }

  if (typeof keys === 'function') {
    return keys(result, args);
  }

  return keys;
}
