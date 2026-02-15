import { SetMetadata, UseGuards, applyDecorators, ExecutionContext } from '@nestjs/common';

import { IRateLimitResult } from '../../../shared/types';
import { RateLimitGuard } from '../guards/rate-limit.guard';

/**
 * Metadata key for rate limit options.
 */
export const RATE_LIMIT_OPTIONS = Symbol.for('RATE_LIMIT_OPTIONS');

/**
 * Key extractor function type.
 */
export type KeyExtractor = (context: ExecutionContext) => string | Promise<string>;

/**
 * Rate limit options for decorator.
 */
export interface IRateLimitOptions {
  /**
   * Rate limit key or key extractor function.
   * If string: used as-is
   * If function: called with execution context
   * If not provided: uses default key extractor from module config
   *
   * @example
   * ```typescript
   * @RateLimit({ key: 'global' })
   * @RateLimit({ key: (ctx) => ctx.switchToHttp().getRequest().user.id })
   * ```
   */
  key?: string | KeyExtractor;

  /**
   * Algorithm to use.
   * @default from module config
   */
  algorithm?: 'fixed-window' | 'sliding-window' | 'token-bucket';

  /**
   * Max requests (fixed/sliding) or capacity (token bucket).
   * @default from module config
   */
  points?: number;

  /**
   * Window duration in seconds.
   * @default from module config
   */
  duration?: number;

  /**
   * Tokens per second (token bucket only).
   */
  refillRate?: number;

  /**
   * Skip condition function.
   * If returns true, rate limiting is skipped.
   *
   * @example
   * ```typescript
   * @RateLimit({
   *   skip: (ctx) => {
   *     const req = ctx.switchToHttp().getRequest();
   *     return req.user?.role === 'admin';
   *   }
   * })
   * ```
   */
  skip?: (context: ExecutionContext) => boolean | Promise<boolean>;

  /**
   * Custom error message.
   */
  message?: string;

  /**
   * Custom error factory.
   * Allows creating custom errors based on rate limit result.
   *
   * @example
   * ```typescript
   * @RateLimit({
   *   errorFactory: (result) => new CustomRateLimitError(result)
   * })
   * ```
   */
  errorFactory?: (result: IRateLimitResult) => Error;
}

/**
 * Rate limit decorator.
 * Can be applied to methods or classes.
 *
 * @param options - Rate limit options
 * @returns Decorator function
 *
 * @example
 * ```typescript
 * // Method decorator
 * @Controller('api')
 * export class ApiController {
 *   @Get('data')
 *   @RateLimit({ points: 10, duration: 60 })
 *   getData() {
 *     return { data: 'value' };
 *   }
 * }
 *
 * // Class decorator (applies to all methods)
 * @Controller('api')
 * @RateLimit({ points: 100, duration: 60 })
 * export class ApiController {
 *   @Get('data')
 *   getData() {
 *     return { data: 'value' };
 *   }
 * }
 *
 * // Custom key extractor
 * @Get('user-data')
 * @RateLimit({
 *   key: (ctx) => {
 *     const req = ctx.switchToHttp().getRequest();
 *     return `user:${req.user.id}`;
 *   },
 *   points: 50,
 * })
 * getUserData() {
 *   return { data: 'value' };
 * }
 * ```
 */
export function RateLimit(options: IRateLimitOptions = {}): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(RATE_LIMIT_OPTIONS, options), UseGuards(RateLimitGuard)) as MethodDecorator & ClassDecorator;
}
