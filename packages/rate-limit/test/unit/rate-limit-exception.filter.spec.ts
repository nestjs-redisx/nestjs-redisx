import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { RateLimitExceptionFilter } from '../../src/rate-limit/api/filters/rate-limit-exception.filter';
import { RateLimitExceededError } from '../../src/shared/errors';
import type { RateLimitResult } from '../../src/shared/types';

describe('RateLimitExceptionFilter', () => {
  let filter: RateLimitExceptionFilter;
  let mockResponse: MockedObject<any>;
  let mockHost: MockedObject<ArgumentsHost>;

  beforeEach(() => {
    filter = new RateLimitExceptionFilter();

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

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
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
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
    expect(mockResponse.header).toHaveBeenCalledWith('Retry-After', '45');
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
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Rate limit exceeded for API',
      error: 'Too Many Requests',
      retryAfter: 60,
      limit: 50,
      remaining: 0,
      reset: 1706400000,
    });
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
    const jsonCall = mockResponse.json.mock.calls[0][0];
    expect(jsonCall.limit).toBe(200);
    expect(jsonCall.remaining).toBe(0);
    expect(jsonCall.reset).toBe(1706400120);
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
    expect(mockResponse.json).toHaveBeenCalled();
  });

  it('should call all response methods', () => {
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
    expect(mockResponse.status).toHaveBeenCalled();
    expect(mockResponse.header).toHaveBeenCalled();
    expect(mockResponse.json).toHaveBeenCalled();
  });
});
