import { Catch, ExceptionFilter, ArgumentsHost, HttpStatus, Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { IdempotencyError, IdempotencyKeyRequiredError, IdempotencyFingerprintMismatchError, IdempotencyTimeoutError, IdempotencyFailedError } from '../../../shared/errors';

/**
 * Exception filter for idempotency errors.
 *
 * Without this filter the idempotency errors (which extend `RedisXError`, not
 * `HttpException`) would surface as `500 Internal Server Error`. That is wrong
 * for situations that are part of normal idempotent-request handling — a reused
 * key with a different body, a still-in-progress concurrent request, or a key
 * whose previous attempt failed. This filter maps each error to an appropriate
 * 4xx status while leaving genuinely unexpected errors as 500.
 */
@Catch(IdempotencyError)
export class IdempotencyExceptionFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: IdempotencyError, host: ArgumentsHost): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      throw new Error('IdempotencyExceptionFilter: HttpAdapterHost is not initialized. Ensure the NestJS application has bootstrapped with an HTTP adapter before handling requests.');
    }

    const response = host.switchToHttp().getResponse();
    const status = this.resolveStatus(exception);

    const body = {
      statusCode: status,
      message: exception.message,
      error: this.reasonPhrase(status),
      idempotencyKey: exception.idempotencyKey || undefined,
    };

    httpAdapter.reply(response, body, status);
  }

  /**
   * Maps an idempotency error to its HTTP status code.
   *
   * - Missing/invalid key -> 400 Bad Request
   * - Reused key with a different request -> 422 Unprocessable Entity
   * - Concurrent request still in progress (timeout) -> 409 Conflict
   * - Previous request with the same key failed -> 409 Conflict
   * - Anything else (unexpected) -> 500 Internal Server Error
   */
  private resolveStatus(exception: IdempotencyError): HttpStatus {
    if (exception instanceof IdempotencyKeyRequiredError) {
      return HttpStatus.BAD_REQUEST;
    }
    if (exception instanceof IdempotencyFingerprintMismatchError) {
      return HttpStatus.UNPROCESSABLE_ENTITY;
    }
    if (exception instanceof IdempotencyTimeoutError) {
      return HttpStatus.CONFLICT;
    }
    if (exception instanceof IdempotencyFailedError) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private reasonPhrase(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Unprocessable Entity';
      default:
        return 'Internal Server Error';
    }
  }
}
