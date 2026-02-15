/**
 * @InvalidateTags decorator for automatic tag invalidation.
 *
 * Uses immediate proxy-based wrapping (not deferred to interceptor).
 * Works on ANY Injectable class methods (services, repositories, etc).
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import { getCacheService } from './cached.decorator';
import { INVALIDATE_TAGS_KEY } from '../../../shared/constants';

const logger = new Logger('InvalidateTags');

export interface IInvalidateTagsOptions {
  /**
   * Tags to invalidate. Can be static array or function of method args.
   */
  tags: string[] | ((...args: unknown[]) => string[]);

  /**
   * When to invalidate: 'before' or 'after' method execution.
   * Default: 'after'
   */
  when?: 'before' | 'after';
}

/**
 * Invalidates cache tags when method is called.
 *
 * Works on any Injectable class method, not just controllers.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @InvalidateTags({
 *     tags: (id: string) => [`user:${id}`, 'users'],
 *     when: 'after',
 *   })
 *   async updateUser(id: string, data: UpdateUserDto): Promise<User> {
 *     return this.userRepository.update(id, data);
 *   }
 *
 *   @InvalidateTags({ tags: ['users'] })
 *   async deleteUser(id: string): Promise<void> {
 *     await this.userRepository.delete(id);
 *   }
 * }
 * ```
 */
export function InvalidateTags(options: IInvalidateTagsOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const when = options.when ?? 'after';

    // Replace method with invalidation proxy
    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const cacheService = getCacheService();

      // Resolve tags
      const tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;

      // Invalidate BEFORE if configured
      if (when === 'before' && cacheService && tags.length > 0) {
        try {
          await cacheService.invalidateTags(tags);
        } catch (error) {
          logger.error(`@InvalidateTags: Failed to invalidate tags before method:`, error);
        }
      }

      // Execute original method
      const result = await originalMethod.apply(this, args);

      // Invalidate AFTER if configured (default)
      if (when === 'after' && cacheService && tags.length > 0) {
        try {
          await cacheService.invalidateTags(tags);
        } catch (error) {
          logger.error(`@InvalidateTags: Failed to invalidate tags after method:`, error);
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
    Reflect.defineMetadata(INVALIDATE_TAGS_KEY, options, descriptor.value);

    return descriptor;
  };
}
