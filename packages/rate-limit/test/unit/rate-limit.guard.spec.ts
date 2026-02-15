import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../../src/rate-limit/api/guards/rate-limit.guard';
import type { IRateLimitService } from '../../src/rate-limit/application/ports/rate-limit-service.port';
import type { IRateLimitPluginOptions, RateLimitResult } from '../../src/shared/types';
import { RateLimitExceededError } from '../../src/shared/errors';
import { RATE_LIMIT_OPTIONS, type IRateLimitOptions } from '../../src/rate-limit/api/decorators/rate-limit.decorator';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let mockService: MockedObject<IRateLimitService>;
  let mockReflector: MockedObject<Reflector>;
  let mockContext: MockedObject<ExecutionContext>;
  let mockRequest: any;
  let mockResponse: any;
  let config: IRateLimitPluginOptions;

  const successResult: IRateLimitResult = {
    allowed: true,
    limit: 100,
    remaining: 99,
    reset: Math.floor(Date.now() / 1000) + 60,
    current: 1,
  };

  const failedResult: IRateLimitResult = {
    allowed: false,
    limit: 100,
    remaining: 0,
    reset: Math.floor(Date.now() / 1000) + 60,
    current: 100,
    retryAfter: 30,
  };

  beforeEach(() => {
    mockRequest = {
      ip: '127.0.0.1',
      headers: {},
    };

    mockResponse = {
      header: vi.fn().mockReturnThis(),
    };

    mockContext = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as MockedObject<ExecutionContext>;

    mockService = {
      check: vi.fn().mockResolvedValue(successResult),
      peek: vi.fn(),
      reset: vi.fn(),
      getState: vi.fn(),
    } as unknown as MockedObject<IRateLimitService>;

    mockReflector = {
      get: vi.fn().mockReturnValue({}),
    } as unknown as MockedObject<Reflector>;

    config = {
      defaultKeyExtractor: 'ip',
      includeHeaders: true,
      headers: {
        limit: 'X-RateLimit-Limit',
        remaining: 'X-RateLimit-Remaining',
        reset: 'X-RateLimit-Reset',
        retryAfter: 'Retry-After',
      },
    };

    guard = new RateLimitGuard(mockService, config, mockReflector);
  });

  describe('canActivate', () => {
    it('should allow request when under limit', async () => {
      // Given
      mockService.check.mockResolvedValue(successResult);

      // When
      const result = await guard.canActivate(mockContext);

      // Then
      expect(result).toBe(true);
      expect(mockService.check).toHaveBeenCalled();
    });

    it('should block request when limit exceeded', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);

      // When/Then
      try {
        await guard.canActivate(mockContext);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitExceededError/);
        expect((error as RateLimitExceededError).retryAfter).toBe(30);
      }
    });

    it('should set response headers', async () => {
      // Given
      mockService.check.mockResolvedValue(successResult);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockResponse.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockResponse.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
      expect(mockResponse.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should set retry-after header when limit exceeded', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);

      // When/Then
      try {
        await guard.canActivate(mockContext);
      } catch (error) {
        // Expected
      }

      expect(mockResponse.header).toHaveBeenCalledWith('Retry-After', '30');
    });

    it('should not set headers when includeHeaders is false', async () => {
      // Given
      const guardWithoutHeaders = new RateLimitGuard(mockService, { ...config, includeHeaders: false }, mockReflector);

      // When
      await guardWithoutHeaders.canActivate(mockContext);

      // Then
      expect(mockResponse.header).not.toHaveBeenCalled();
    });
  });

  describe('key extraction', () => {
    it('should extract key from IP by default', async () => {
      // Given
      mockRequest.ip = '192.168.1.1';

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('192.168.1.1', expect.any(Object));
    });

    it('should extract IP from X-Forwarded-For header', async () => {
      // Given
      mockRequest.headers['x-forwarded-for'] = '10.0.0.1, 10.0.0.2';

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('10.0.0.1', expect.any(Object));
    });

    it('should extract IP from X-Real-IP header', async () => {
      // Given
      mockRequest.headers['x-real-ip'] = '172.16.0.1';

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('172.16.0.1', expect.any(Object));
    });

    it('should use unknown when IP not available', async () => {
      // Given
      mockRequest.ip = undefined;

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('unknown', expect.any(Object));
    });

    it('should extract user ID from request', async () => {
      // Given
      mockRequest.user = { id: 'user123' };
      const options: IRateLimitOptions = { key: 'user' };
      mockReflector.get.mockReturnValue(options);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('user:user123', expect.any(Object));
    });

    it('should throw error when user ID not found', async () => {
      // Given
      mockRequest.user = undefined;
      const options: IRateLimitOptions = { key: 'user' };
      mockReflector.get.mockReturnValue(options);

      // When/Then
      await expect(guard.canActivate(mockContext)).rejects.toThrow('User ID not found');
    });

    it('should extract API key from X-API-Key header', async () => {
      // Given
      mockRequest.headers['x-api-key'] = 'key123';
      const options: IRateLimitOptions = { key: 'apiKey' };
      mockReflector.get.mockReturnValue(options);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('apikey:key123', expect.any(Object));
    });

    it('should throw error when API key not found', async () => {
      // Given
      const options: IRateLimitOptions = { key: 'apiKey' };
      mockReflector.get.mockReturnValue(options);

      // When/Then
      await expect(guard.canActivate(mockContext)).rejects.toThrow('API key not found');
    });

    it('should use static string key from decorator', async () => {
      // Given
      const options: IRateLimitOptions = { key: 'global-api' };
      mockReflector.get.mockReturnValue(options);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith('global-api', expect.any(Object));
    });

    it('should use custom key extractor function', async () => {
      // Given
      const keyExtractor = vi.fn().mockReturnValue('custom-key-123');
      const options: IRateLimitOptions = { key: keyExtractor };
      mockReflector.get.mockReturnValue(options);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(keyExtractor).toHaveBeenCalledWith(mockContext);
      expect(mockService.check).toHaveBeenCalledWith('custom-key-123', expect.any(Object));
    });
  });

  describe('skip condition', () => {
    it('should skip rate limiting when decorator skip returns true', async () => {
      // Given
      const skipFn = vi.fn().mockResolvedValue(true);
      const options: IRateLimitOptions = { skip: skipFn };
      mockReflector.get.mockReturnValue(options);

      // When
      const result = await guard.canActivate(mockContext);

      // Then
      expect(result).toBe(true);
      expect(skipFn).toHaveBeenCalledWith(mockContext);
      expect(mockService.check).not.toHaveBeenCalled();
    });

    it('should skip rate limiting when module skip returns true', async () => {
      // Given
      const skipFn = vi.fn().mockResolvedValue(true);
      const guardWithSkip = new RateLimitGuard(mockService, { ...config, skip: skipFn }, mockReflector);

      // When
      const result = await guardWithSkip.canActivate(mockContext);

      // Then
      expect(result).toBe(true);
      expect(skipFn).toHaveBeenCalledWith(mockContext);
      expect(mockService.check).not.toHaveBeenCalled();
    });

    it('should not skip when skip returns false', async () => {
      // Given
      const skipFn = vi.fn().mockResolvedValue(false);
      const options: IRateLimitOptions = { skip: skipFn };
      mockReflector.get.mockReturnValue(options);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(skipFn).toHaveBeenCalled();
      expect(mockService.check).toHaveBeenCalled();
    });
  });

  describe('error factory', () => {
    it('should use decorator-level error factory', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);
      const customError = new Error('Custom decorator error');
      const errorFactory = vi.fn().mockReturnValue(customError);
      const options: IRateLimitOptions = { errorFactory };
      mockReflector.get.mockReturnValue(options);

      // When/Then
      await expect(guard.canActivate(mockContext)).rejects.toThrow('Custom decorator error');
      expect(errorFactory).toHaveBeenCalledWith(failedResult);
    });

    it('should use module-level error factory', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);
      const customError = new Error('Custom module error');
      const errorFactory = vi.fn().mockReturnValue(customError);
      const guardWithFactory = new RateLimitGuard(mockService, { ...config, errorFactory }, mockReflector);

      // When/Then
      await expect(guardWithFactory.canActivate(mockContext)).rejects.toThrow('Custom module error');
      expect(errorFactory).toHaveBeenCalledWith(failedResult);
    });

    it('should use custom message from options', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);
      const options: IRateLimitOptions = { message: 'Custom rate limit message' };
      mockReflector.get.mockReturnValue(options);

      // When/Then
      try {
        await guard.canActivate(mockContext);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toBe('Custom rate limit message');
      }
    });

    it('should use default error message', async () => {
      // Given
      mockService.check.mockResolvedValue(failedResult);

      // When/Then
      try {
        await guard.canActivate(mockContext);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('Rate limit exceeded');
        expect((error as Error).message).toContain('30 seconds');
      }
    });
  });

  describe('options merging', () => {
    it('should merge class-level and method-level options', () => {
      // Given
      const classOptions: IRateLimitOptions = { points: 100 };
      const methodOptions: IRateLimitOptions = { duration: 60 };
      mockReflector.get.mockReturnValueOnce(methodOptions).mockReturnValueOnce(classOptions);

      // When
      guard.canActivate(mockContext);

      // Then
      expect(mockReflector.get).toHaveBeenCalledWith(RATE_LIMIT_OPTIONS, mockContext.getHandler());
      expect(mockReflector.get).toHaveBeenCalledWith(RATE_LIMIT_OPTIONS, mockContext.getClass());
    });

    it('should prioritize method options over class options', async () => {
      // Given
      const classOptions: IRateLimitOptions = { points: 50, duration: 30 };
      const methodOptions: IRateLimitOptions = { points: 100 };
      mockReflector.get.mockReturnValueOnce(methodOptions).mockReturnValueOnce(classOptions);

      // When
      await guard.canActivate(mockContext);

      // Then
      expect(mockService.check).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ points: 100, duration: 30 }));
    });
  });

  describe('custom headers', () => {
    it('should use custom header names from config', async () => {
      // Given
      const guardWithCustomHeaders = new RateLimitGuard(
        mockService,
        {
          ...config,
          headers: {
            limit: 'X-Custom-Limit',
            remaining: 'X-Custom-Remaining',
            reset: 'X-Custom-Reset',
            retryAfter: 'X-Custom-Retry',
          },
        },
        mockReflector,
      );

      // When
      await guardWithCustomHeaders.canActivate(mockContext);

      // Then
      expect(mockResponse.header).toHaveBeenCalledWith('X-Custom-Limit', '100');
      expect(mockResponse.header).toHaveBeenCalledWith('X-Custom-Remaining', '99');
      expect(mockResponse.header).toHaveBeenCalledWith('X-Custom-Reset', expect.any(String));
    });
  });
});
