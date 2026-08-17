import { Logger } from '@nestjs/common';

const logger = new Logger('SessionMiddlewareStore');

/**
 * Invokes a middleware callback exactly once, containing its own exceptions.
 *
 * The naive `.then(cb).catch(cb)` chain re-enters the callback with the error
 * a throwing callback produced — double invocation corrupts the middleware's
 * request state. Callback errors are the application's bug; they are logged
 * and never re-dispatched.
 */
export function invokeCallback(callback: ((...args: never[]) => void) | undefined, ...args: unknown[]): void {
  if (!callback) {
    return;
  }
  try {
    (callback as (...callbackArgs: unknown[]) => void)(...args);
  } catch (error) {
    logger.error(`Session store callback threw: ${(error as Error).message}`);
  }
}
