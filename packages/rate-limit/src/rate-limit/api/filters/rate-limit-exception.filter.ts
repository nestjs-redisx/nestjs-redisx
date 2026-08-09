import { Catch, ExceptionFilter, ArgumentsHost, HttpStatus, Inject, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { RateLimitError, RateLimitExceededError, RateLimitScriptError } from '../../../shared/errors';

/**
 * Exception filter for rate-limit errors.
 *
 * - `RateLimitExceededError` -> `429 Too Many Requests` (with rate-limit headers).
 * - `RateLimitScriptError` (raised on store failure under `errorPolicy:
 *   'fail-closed'`) -> `503 Service Unavailable`. Without this, the store error
 *   is NOT a subclass of `RateLimitExceededError` and would surface as an
 *   uncaught `500` on every request while Redis is unavailable.
 *
 * Catches the base `RateLimitError` so both cases are handled; any other
 * subclass falls back to 503 (a rate-limit subsystem failure, not the caller's
 * fault).
 */
@Catch(RateLimitError)
export class RateLimitExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RateLimitExceptionFilter.name);

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: RateLimitError, host: ArgumentsHost): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      throw new Error('RateLimitExceptionFilter: HttpAdapterHost is not initialized. Ensure the NestJS application has bootstrapped with an HTTP adapter before handling requests.');
    }

    const response = host.switchToHttp().getResponse();

    if (exception instanceof RateLimitExceededError) {
      const result = exception.result;
      const body = {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: exception.message,
        error: 'Too Many Requests',
        retryAfter: exception.retryAfter,
        limit: result?.limit,
        remaining: result?.remaining,
        reset: result?.reset,
      };

      httpAdapter.setHeader(response, 'Retry-After', exception.retryAfter.toString());
      httpAdapter.reply(response, body, HttpStatus.TOO_MANY_REQUESTS);
      return;
    }

    // Store/script failure under fail-closed (or any other rate-limit error):
    // the limiter itself is degraded — 503, not a 500 — and log it so the
    // outage is visible without being mistaken for an application bug.
    if (exception instanceof RateLimitScriptError) {
      this.logger.error(`Rate-limit store unavailable, rejecting request (fail-closed): ${exception.message}`);
    }

    const body = {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Rate limiting is temporarily unavailable',
      error: 'Service Unavailable',
    };
    httpAdapter.reply(response, body, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
