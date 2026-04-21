import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { RateLimitExceptionFilter } from '../../src/rate-limit/api/filters/rate-limit-exception.filter';
import { RateLimitExceededError } from '../../src/shared/errors';
import type { IRateLimitResult } from '../../src/shared/types';

describe('RateLimitExceptionFilter', () => {
  let filter: RateLimitExceptionFilter;
  let mockResponse: MockedObject<any>;
  let mockHost: MockedObject<ArgumentsHost>;
  let mockHttpAdapter: { setHeader: ReturnType<typeof vi.fn>; reply: ReturnType<typeof vi.fn> };
  let mockAdapterHost: { httpAdapter: typeof mockHttpAdapter };

  beforeEach(() => {
    mockHttpAdapter = {
      setHeader: vi.fn(),
      reply: vi.fn(),
    };
    mockAdapterHost = { httpAdapter: mockHttpAdapter };

    filter = new RateLimitExceptionFilter(mockAdapterHost as any);

    mockResponse = {};

    mockHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: vi.fn(),
      }),
    } as unknown as MockedObject<ArgumentsHost>;
  });

  it('should catch RateLimitExceededError and return 429 status', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 60,
      current: 100,
      retryAfter: 30,
    };
    const error = new RateLimitExceededError('Rate limit exceeded', result);

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(mockResponse, expect.any(Object), HttpStatus.TOO_MANY_REQUESTS);
  });

  it('should set Retry-After header', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 60,
      current: 100,
      retryAfter: 45,
    };
    const error = new RateLimitExceededError('Too many requests', result);

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.setHeader).toHaveBeenCalledWith(mockResponse, 'Retry-After', '45');
  });

  it('should return JSON response with error details', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 50,
      remaining: 0,
      reset: 1706400000,
      current: 50,
      retryAfter: 60,
    };
    const error = new RateLimitExceededError('Rate limit exceeded for API', result);

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
      mockResponse,
      {
        statusCode: 429,
        message: 'Rate limit exceeded for API',
        error: 'Too Many Requests',
        retryAfter: 60,
        limit: 50,
        remaining: 0,
        reset: 1706400000,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('should include result data in response', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 200,
      remaining: 0,
      reset: 1706400120,
      current: 200,
      retryAfter: 120,
    };
    const error = new RateLimitExceededError('Limit exceeded', result);

    // When
    filter.catch(error, mockHost);

    // Then
    const body = mockHttpAdapter.reply.mock.calls[0][1];
    expect(body.limit).toBe(200);
    expect(body.remaining).toBe(0);
    expect(body.reset).toBe(1706400120);
  });

  it('should handle error without result', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1706400000,
      current: 100,
    };
    const error = new RateLimitExceededError('Limit exceeded', result);

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.reply).toHaveBeenCalled();
  });

  it('should call setHeader and reply on the http adapter', () => {
    // Given
    const result: IRateLimitResult = {
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1706400000,
      current: 100,
      retryAfter: 30,
    };
    const error = new RateLimitExceededError('Rate limit exceeded', result);

    // When
    filter.catch(error, mockHost);

    // Then
    expect(mockHttpAdapter.setHeader).toHaveBeenCalled();
    expect(mockHttpAdapter.reply).toHaveBeenCalled();
  });

  describe('uninitialized HttpAdapterHost', () => {
    it('should throw when httpAdapter is null', () => {
      // Given
      const filterWithoutAdapter = new RateLimitExceptionFilter({ httpAdapter: null } as any);
      const result: IRateLimitResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        reset: 1706400000,
        current: 100,
        retryAfter: 30,
      };
      const error = new RateLimitExceededError('Rate limit exceeded', result);

      // When/Then
      expect(() => filterWithoutAdapter.catch(error, mockHost)).toThrow(/HttpAdapterHost is not initialized/);
    });

    it('should throw when httpAdapter is undefined', () => {
      // Given
      const filterWithoutAdapter = new RateLimitExceptionFilter({ httpAdapter: undefined } as any);
      const result: IRateLimitResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        reset: 1706400000,
        current: 100,
        retryAfter: 30,
      };
      const error = new RateLimitExceededError('Rate limit exceeded', result);

      // When/Then
      expect(() => filterWithoutAdapter.catch(error, mockHost)).toThrow(/HttpAdapterHost is not initialized/);
    });
  });
});
