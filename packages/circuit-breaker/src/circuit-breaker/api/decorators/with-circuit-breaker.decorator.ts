/**
 * @WithCircuitBreaker decorator for distributed circuit breaking.
 *
 * Uses immediate proxy-based wrapping (not a NestJS guard/interceptor), so it
 * works on ANY Injectable class method — services, repositories, gateways —
 * not just controllers. Mirrors the @WithLock / @Cached pattern.
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';

const logger = new Logger('WithCircuitBreaker');

/**
 * Metadata key for @WithCircuitBreaker options.
 */
export const WITH_CIRCUIT_BREAKER_OPTIONS = Symbol.for('WITH_CIRCUIT_BREAKER_OPTIONS');

/**
 * Minimal circuit breaker service shape used by the decorator (lazy-injected).
 */
interface IDecoratorCircuitBreakerService {
  execute<T>(
    key: string,
    fn: () => Promise<T>,
    options?: {
      failureThreshold?: number;
      windowMs?: number;
      openDurationMs?: number;
      halfOpenMaxCalls?: number;
      successThreshold?: number;
      probeTimeoutMs?: number;
      fallback?: () => T | Promise<T>;
    },
  ): Promise<T>;
}

// Global service getter for lazy injection (registered by the plugin).
let globalCircuitBreakerServiceGetter: (() => IDecoratorCircuitBreakerService) | null = null;

/**
 * Register circuit breaker service getter for lazy injection.
 * Called by CircuitBreakerPlugin during initialization.
 */
export function registerCircuitBreakerServiceGetter(getter: () => IDecoratorCircuitBreakerService): void {
  globalCircuitBreakerServiceGetter = getter;
}

/**
 * Options for @WithCircuitBreaker decorator.
 */
export interface IWithCircuitBreakerOptions {
  /**
   * Circuit key or key builder function.
   *
   * @example
   * ```typescript
   * @WithCircuitBreaker({ key: 'payments-api' })
   * @WithCircuitBreaker({ key: (dto) => `tenant:${dto.tenantId}` })
   * @WithCircuitBreaker({ key: 'user:{0}' }) // interpolates the first argument
   * ```
   */
  key: string | ((...args: unknown[]) => string);

  /** Override failureThreshold for this method. */
  failureThreshold?: number;
  /** Override windowMs for this method. */
  windowMs?: number;
  /** Override openDurationMs for this method. */
  openDurationMs?: number;
  /** Override halfOpenMaxCalls for this method. */
  halfOpenMaxCalls?: number;
  /** Override successThreshold for this method. */
  successThreshold?: number;
  /** Override probeTimeoutMs for this method (defaults to the resolved openDurationMs). */
  probeTimeoutMs?: number;

  /**
   * Called with the original arguments when the breaker rejects the call
   * (OPEN / probe budget exhausted). Its return value becomes the method result.
   * Takes precedence over `onOpen`.
   */
  fallback?: (...args: unknown[]) => unknown;

  /**
   * Behaviour when the breaker rejects the call and no `fallback` is provided.
   * - 'throw': throw CircuitBreakerOpenError (default)
   * - 'skip': skip execution and resolve to undefined
   */
  onOpen?: 'throw' | 'skip';

  /**
   * Bypass the breaker for certain calls. Evaluated with the method arguments;
   * if it returns true, the original method runs directly without the breaker
   * (no state is read or recorded).
   *
   * @example
   * ```typescript
   * @WithCircuitBreaker({ key: 'api', skip: (req) => req.internal === true })
   * ```
   */
  skip?: (...args: unknown[]) => boolean | Promise<boolean>;
}

/**
 * Decorator that guards a method with a distributed circuit breaker.
 *
 * Works on any Injectable class method, not just controllers.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class PaymentsService {
 *   @WithCircuitBreaker({ key: 'stripe', failureThreshold: 5, openDurationMs: 30000 })
 *   async charge(dto: ChargeDto) {
 *     return this.stripe.charge(dto);
 *   }
 *
 *   @WithCircuitBreaker({ key: 'stripe', fallback: () => ({ queued: true }) })
 *   async chargeWithFallback(dto: ChargeDto) {
 *     return this.stripe.charge(dto);
 *   }
 * }
 * ```
 */
export function WithCircuitBreaker(options: IWithCircuitBreakerOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      // Lazy inject the circuit breaker service on first call.
      if (!globalCircuitBreakerServiceGetter) {
        logger.warn('@WithCircuitBreaker: CircuitBreakerService not yet available, executing method without breaker');
        return originalMethod.apply(this, args);
      }

      const service = globalCircuitBreakerServiceGetter();
      if (!service) {
        logger.warn('@WithCircuitBreaker: service getter returned null, executing method without breaker');
        return originalMethod.apply(this, args);
      }

      // Bypass the breaker entirely when skip() opts out for these arguments.
      if (options.skip && (await options.skip(...args))) {
        return originalMethod.apply(this, args);
      }

      const key = buildCircuitKey(args, options);
      const fallback = resolveFallback(args, options);

      return service.execute(key, () => originalMethod.apply(this, args), {
        failureThreshold: options.failureThreshold,
        windowMs: options.windowMs,
        openDurationMs: options.openDurationMs,
        halfOpenMaxCalls: options.halfOpenMaxCalls,
        successThreshold: options.successThreshold,
        probeTimeoutMs: options.probeTimeoutMs,
        fallback,
      });
    };

    // Preserve original method name.
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Store metadata on the WRAPPER function for reflection (after replacement).
    Reflect.defineMetadata(WITH_CIRCUIT_BREAKER_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Resolve the fallback thunk from `fallback`/`onOpen`, or undefined to throw.
 */
function resolveFallback(args: unknown[], options: IWithCircuitBreakerOptions): (() => unknown) | undefined {
  if (options.fallback) {
    return () => options.fallback!(...args);
  }
  if (options.onOpen === 'skip') {
    return () => undefined;
  }
  return undefined;
}

/**
 * Builds the circuit key from a template or function.
 */
function buildCircuitKey(args: unknown[], options: IWithCircuitBreakerOptions): string {
  if (typeof options.key === 'function') {
    return options.key(...args);
  }
  return interpolateKey(options.key, args);
}

/**
 * Interpolates a key template with arguments.
 *
 * Supports:
 * - {0}, {1}, ... for positional arguments
 * - {0.id}, {1.name}, ... for object properties
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
