import type { ISpanOptions } from '../../../shared/types';

import type { ISpan } from './span.port';

export interface ITracingService {
  /**
   * Start a new span.
   */
  startSpan(name: string, options?: ISpanOptions): ISpan;

  /**
   * Get the current active span.
   */
  getCurrentSpan(): ISpan | undefined;

  /**
   * Execute function within a span context.
   */
  withSpan<T>(name: string, fn: () => T | Promise<T>, options?: ISpanOptions): Promise<T>;

  /**
   * Add event to current span.
   */
  addEvent(name: string, attributes?: Record<string, unknown>): void;

  /**
   * Set attribute on current span.
   */
  setAttribute(key: string, value: unknown): void;

  /**
   * Record exception on current span.
   */
  recordException(error: Error): void;
}
