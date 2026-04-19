import { Catch, ExceptionFilter, ArgumentsHost, HttpStatus, Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { RateLimitExceededError } from '../../../shared/errors';

/**
 * Exception filter for rate limit errors.
 * Catches RateLimitExceededError and returns 429 Too Many Requests.
 */
@Catch(RateLimitExceededError)
export class RateLimitExceptionFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  /**
   * Catch rate limit exceeded error and format response.
   */
  catch(exception: RateLimitExceededError, host: ArgumentsHost): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      throw new Error('RateLimitExceptionFilter: HttpAdapterHost is not initialized. Ensure the NestJS application has bootstrapped with an HTTP adapter before handling requests.');
    }

    const response = host.switchToHttp().getResponse();
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
  }
}
