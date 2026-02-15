import { Catch, ExceptionFilter, ArgumentsHost, HttpStatus } from '@nestjs/common';

import { RateLimitExceededError } from '../../../shared/errors';

/**
 * Exception filter for rate limit errors.
 * Catches RateLimitExceededError and returns 429 Too Many Requests.
 */
@Catch(RateLimitExceededError)
export class RateLimitExceptionFilter implements ExceptionFilter {
  /**
   * Catch rate limit exceeded error and format response.
   */
  catch(exception: RateLimitExceededError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const result = exception.result;

    response.status(HttpStatus.TOO_MANY_REQUESTS).header('Retry-After', exception.retryAfter.toString()).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: exception.message,
      error: 'Too Many Requests',
      retryAfter: exception.retryAfter,
      limit: result?.limit,
      remaining: result?.remaining,
      reset: result?.reset,
    });
  }
}
