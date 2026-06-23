import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';

import { IdempotencyExceptionFilter } from '../../src/idempotency/api/filters/idempotency-exception.filter';
import { IdempotencyError, IdempotencyKeyRequiredError, IdempotencyFingerprintMismatchError, IdempotencyTimeoutError, IdempotencyFailedError, IdempotencyRecordNotFoundError } from '../../src/shared/errors';

describe('IdempotencyExceptionFilter', () => {
  let filter: IdempotencyExceptionFilter;
  let mockResponse: MockedObject<any>;
  let mockHost: MockedObject<ArgumentsHost>;
  let mockHttpAdapter: { reply: ReturnType<typeof vi.fn> };
  let mockAdapterHost: { httpAdapter: typeof mockHttpAdapter };

  beforeEach(() => {
    mockHttpAdapter = { reply: vi.fn() };
    mockAdapterHost = { httpAdapter: mockHttpAdapter };
    filter = new IdempotencyExceptionFilter(mockAdapterHost as any);

    mockResponse = {};
    mockHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: vi.fn(),
      }),
    } as unknown as MockedObject<ArgumentsHost>;
  });

  it('should map IdempotencyKeyRequiredError to 400 Bad Request', () => {
    // Given
    const error = new IdempotencyKeyRequiredError();

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, error: 'Bad Request' }), HttpStatus.BAD_REQUEST);
  });

  it('should map IdempotencyFingerprintMismatchError to 422 Unprocessable Entity', () => {
    // Given
    const error = new IdempotencyFingerprintMismatchError('key-1');

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.objectContaining({ statusCode: HttpStatus.UNPROCESSABLE_ENTITY, error: 'Unprocessable Entity', idempotencyKey: 'key-1' }), HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('should map IdempotencyTimeoutError to 409 Conflict', () => {
    // Given
    const error = new IdempotencyTimeoutError('key-2');

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.objectContaining({ statusCode: HttpStatus.CONFLICT, error: 'Conflict' }), HttpStatus.CONFLICT);
  });

  it('should map IdempotencyFailedError to 409 Conflict', () => {
    // Given
    const error = new IdempotencyFailedError('key-3', 'boom');

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.objectContaining({ statusCode: HttpStatus.CONFLICT }), HttpStatus.CONFLICT);
  });

  it('should map an unexpected idempotency error to 500 Internal Server Error', () => {
    // Given - a subtype the filter does not explicitly map
    const error = new IdempotencyRecordNotFoundError('key-4');

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.objectContaining({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Internal Server Error' }), HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('should include the error message in the response body', () => {
    // Given
    const error = new IdempotencyFingerprintMismatchError('key-5');

    // When
    filter.catch(error, mockHost);

    // Then
    const body = mockHttpAdapter.reply.mock.calls[0][1];
    expect(body.message).toContain('key-5');
  });

  it('should accept the base IdempotencyError directly', () => {
    // Given - the @Catch target itself
    const error = new IdempotencyError('generic', 'IDEMPOTENCY_KEY_INVALID' as never, 'key-6');

    // When
    filter.catch(error, mockHost);

    // Then - unmapped base class falls back to 500
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.any(Object), HttpStatus.INTERNAL_SERVER_ERROR);
  });

  describe('uninitialized HttpAdapterHost', () => {
    it('should throw when httpAdapter is null', () => {
      // Given
      const filterWithoutAdapter = new IdempotencyExceptionFilter({ httpAdapter: null } as any);
      const error = new IdempotencyFailedError('key-7');

      // When/Then
      expect(() => filterWithoutAdapter.catch(error, mockHost)).toThrow(/HttpAdapterHost is not initialized/);
    });
  });
});
