/**
 * @Dedupe decorator — run a method only for the FIRST occurrence of its key
 * within the window; duplicate calls are skipped (resolve to undefined).
 *
 * Uses immediate proxy-based wrapping (etalon: @WithLock), so it works on
 * ANY @Injectable class method.
 */

import { Logger } from '@nestjs/common';
import 'reflect-metadata';

const logger = new Logger('Dedupe');

/**
 * Metadata key for @Dedupe decorator options (set on the wrapper).
 */
export const DEDUPE_OPTIONS = Symbol.for('DEDUPE_OPTIONS');

/**
 * Dedup service slice the decorator needs.
 */
interface IDecoratorDedupService {
  dedupe<T>(key: string, fn: () => Promise<T>, options?: { window?: number }): Promise<T | undefined>;
}

// Global service getter for lazy injection. On `globalThis` under a
// `Symbol.for` key: with the dual CJS + ESM build a process can load both
// copies of this module, and module-scoped state would split between them.
const SERVICE_GETTER_KEY = Symbol.for('nestjs-redisx.dedup.service-getter');

function getterSlot(): { current: (() => IDecoratorDedupService) | null } {
  const slot = globalThis as Record<symbol, unknown>;
  let holder = slot[SERVICE_GETTER_KEY] as { current: (() => IDecoratorDedupService) | null } | undefined;
  if (!holder) {
    holder = { current: null };
    slot[SERVICE_GETTER_KEY] = holder;
  }
  return holder;
}

/**
 * Registers the dedup service getter for lazy injection.
 * Called by DedupPlugin during initialization; null resets (test aid).
 */
export function registerDedupServiceGetter(getter: (() => IDecoratorDedupService) | null): void {
  getterSlot().current = getter;
}

/**
 * Options for @Dedupe.
 */
export interface IDedupeOptions {
  /**
   * Deduplication key or key builder function.
   *
   * @example
   * ```typescript
   * @Dedupe({ key: 'webhook:{0}' })                 // first argument
   * @Dedupe({ key: (event) => `evt:${event.id}` })  // custom function
   * ```
   */
  key: string | ((...args: unknown[]) => string);

  /**
   * Deduplication window in milliseconds.
   * Defaults to the plugin `defaultWindow`.
   */
  window?: number;
}

/**
 * Skips duplicate executions of the decorated method within the window.
 *
 * The first call (per key, across ALL instances) runs the method; repeats
 * within the window resolve to undefined without running it. When the
 * method throws, this caller's marker is released so a retry is not locked
 * out for the rest of the window.
 *
 * Without the plugin registered, the method EXECUTES without deduplication
 * (with a warning) — fail-open: a possible duplicate is recoverable, a
 * silently skipped business method is not.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class WebhookService {
 *   @Dedupe({ key: 'stripe:{0}', window: 300000 })
 *   async handleEvent(eventId: string, payload: unknown) {
 *     // Runs once per eventId per 5 minutes, fleet-wide
 *   }
 * }
 * ```
 */
export function Dedupe(options: IDedupeOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const getter = getterSlot().current;
      const dedupService = getter?.();
      if (!dedupService) {
        logger.warn('@Dedupe: DedupService not yet available, executing method WITHOUT deduplication');
        return originalMethod.apply(this, args);
      }

      const key = buildDedupeKey(args, options);
      return dedupService.dedupe(key, () => originalMethod.apply(this, args), { window: options.window });
    };

    // Preserve original method name
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      writable: false,
    });

    // Carry over metadata stamped by decorators applied BEFORE this one
    // (written below @Dedupe in source order — e.g. @Cron). Discovery-based
    // consumers (the scheduler among them) read metadata off the prototype's
    // method, which is now the wrapper; without the copy, `@Dedupe` above
    // `@Cron()` silently unregisters the job on every instance.
    for (const metadataKey of Reflect.getOwnMetadataKeys(originalMethod)) {
      Reflect.defineMetadata(metadataKey, Reflect.getOwnMetadata(metadataKey, originalMethod), descriptor.value);
    }

    // Store metadata on the WRAPPER function for reflection
    Reflect.defineMetadata(DEDUPE_OPTIONS, options, descriptor.value);

    return descriptor;
  };
}

/**
 * Builds the dedup key from a template or function.
 * `{n}` placeholders interpolate the n-th argument (stringified).
 */
function buildDedupeKey(args: unknown[], options: IDedupeOptions): string {
  if (typeof options.key === 'function') {
    return options.key(...args);
  }
  return options.key.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = args[Number(index)];
    return value === undefined || value === null ? '' : String(value);
  });
}
