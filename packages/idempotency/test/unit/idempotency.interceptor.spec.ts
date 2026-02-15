import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../src/idempotency/api/interceptors/idempotency.interceptor';
import type { IIdempotencyService } from '../../src/idempotency/application/ports/idempotency-service.port';
import type { IIdempotencyPluginOptions, IIdempotencyRecord } from '../../src/shared/types';
import { IdempotencyFingerprintMismatchError, IdempotencyFailedError } from '../../src/shared/errors';
import { IDEMPOTENT_OPTIONS, type IIdempotentOptions } from '../../src/idempotency/api/decorators/idempotent.decorator';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let mockService: MockedObject<IIdempotencyService>;
  let mockReflector: MockedObject<Reflector>;
  let mockContext: MockedObject<ExecutionContext>;
  let mockNext: MockedObject<CallHandler>;
  let mockRequest: any;
  let mockResponse: any;
  let config: IIdempotencyPluginOptions;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      method: 'POST',
      path: '/api/test',
      body: { data: 'test' },
      query: {},
    };

    mockResponse = {
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
    };

    mockContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as unknown as MockedObject<ExecutionContext>;

    mockNext = {
      handle: vi.fn().mockReturnValue(of({ result: 'success' })),
    } as unknown as MockedObject<CallHandler>;

    mockService = {
      checkAndLock: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as MockedObject<IIdempotencyService>;

    mockReflector = {
      get: vi.fn().mockReturnValue({}),
    } as unknown as MockedObject<Reflector>;

    config = {
      keyPrefix: 'idempotency:',
      defaultTtl: 86400,
      headerName: 'Idempotency-Key',
      fingerprintFields: ['method', 'path', 'body'],
    };

    interceptor = new IdempotencyInterceptor(mockService, config, mockReflector);
  });

  describe('new request', () => {
    it('should process new request and store result', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key1';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      const data = await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(data).toEqual({ result: 'success' });
      expect(mockService.checkAndLock).toHaveBeenCalledWith('key1', expect.any(String), expect.objectContaining({ ttl: undefined }));
      expect(mockService.complete).toHaveBeenCalledWith(
        'key1',
        expect.objectContaining({
          statusCode: 200,
          body: { result: 'success' },
        }),
        expect.any(Object),
      );
    });

    it('should use custom TTL from options', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key2';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });
      const options: IIdempotentOptions = { ttl: 3600 };
      mockReflector.get.mockReturnValue(options);

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('key2', expect.any(String), expect.objectContaining({ ttl: 3600 }));
      expect(mockService.complete).toHaveBeenCalledWith('key2', expect.any(Object), expect.objectContaining({ ttl: 3600 }));
    });
  });

  describe('duplicate request', () => {
    it('should replay stored response', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key3';
      const record: IIdempotencyRecord = {
        status: 'completed',
        fingerprint: 'fp1',
        statusCode: 201,
        response: JSON.stringify({ id: 123 }),
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockService.checkAndLock.mockResolvedValue({ isNew: false, record });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      const data = await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(data).toEqual({ id: 123 });
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockNext.handle).not.toHaveBeenCalled();
    });

    it('should replay response with headers', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key4';
      const record: IIdempotencyRecord = {
        status: 'completed',
        fingerprint: 'fp2',
        statusCode: 200,
        response: JSON.stringify({ data: 'test' }),
        headers: JSON.stringify({ 'Content-Type': 'application/json', 'X-Custom': 'value' }),
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockService.checkAndLock.mockResolvedValue({ isNew: false, record });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Custom', 'value');
    });
  });

  describe('fingerprint mismatch', () => {
    it('should throw error on fingerprint mismatch', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key5';
      mockService.checkAndLock.mockResolvedValue({ isNew: false, fingerprintMismatch: true });

      // When/Then
      try {
        await interceptor.intercept(mockContext, mockNext);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/IdempotencyFingerprintMismatchError/);
        expect((error as IdempotencyFingerprintMismatchError).idempotencyKey).toBe('key5');
      }
    });
  });

  describe('failed previous request', () => {
    it('should throw error when previous request failed', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key6';
      const record: IIdempotencyRecord = {
        status: 'failed',
        fingerprint: 'fp3',
        error: 'Database error',
        createdAt: Date.now(),
      };
      mockService.checkAndLock.mockResolvedValue({ isNew: false, record });

      // When/Then
      try {
        await interceptor.intercept(mockContext, mockNext);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/IdempotencyFailedError/);
        expect((error as IdempotencyFailedError).idempotencyKey).toBe('key6');
      }
    });
  });

  describe('skip condition', () => {
    it('should bypass idempotency when skip returns true', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key7';
      const options: IIdempotentOptions = { skip: vi.fn().mockResolvedValue(true) };
      mockReflector.get.mockReturnValue(options);

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      const data = await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(data).toEqual({ result: 'success' });
      expect(mockService.checkAndLock).not.toHaveBeenCalled();
      expect(options.skip).toHaveBeenCalledWith(mockContext);
    });

    it('should process normally when skip returns false', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key8';
      const options: IIdempotentOptions = { skip: vi.fn().mockResolvedValue(false) };
      mockReflector.get.mockReturnValue(options);
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalled();
    });
  });

  describe('no key', () => {
    it('should bypass idempotency when no key provided', async () => {
      // Given - no idempotency-key header

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      const data = await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(data).toEqual({ result: 'success' });
      expect(mockService.checkAndLock).not.toHaveBeenCalled();
    });
  });

  describe('key extraction', () => {
    it('should extract key from header', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'header-key';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('header-key', expect.any(String), expect.any(Object));
    });

    it('should use custom header name from config', async () => {
      // Given
      config.headerName = 'X-Request-ID';
      mockRequest.headers['x-request-id'] = 'custom-key';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });
      interceptor = new IdempotencyInterceptor(mockService, config, mockReflector);

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('custom-key', expect.any(String), expect.any(Object));
    });

    it('should use custom keyExtractor from options', async () => {
      // Given
      const options: IIdempotentOptions = {
        keyExtractor: (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          return `user-${req.user?.id}`;
        },
      };
      mockRequest.user = { id: 'user123' };
      mockReflector.get.mockReturnValue(options);
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('user-user123', expect.any(String), expect.any(Object));
    });
  });

  describe('fingerprint generation', () => {
    it('should generate fingerprint with default fields', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key9';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('key9', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object));
    });

    it('should generate fingerprint with custom fields from options', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key10';
      mockRequest.query = { filter: 'test' };
      const options: IIdempotentOptions = { fingerprintFields: ['method', 'query'] };
      mockReflector.get.mockReturnValue(options);
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.checkAndLock).toHaveBeenCalledWith('key10', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object));
    });

    it('should use custom fingerprint generator from config', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key11';
      config.fingerprintGenerator = vi.fn().mockReturnValue('custom-fingerprint');
      interceptor = new IdempotencyInterceptor(mockService, config, mockReflector);
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(config.fingerprintGenerator).toHaveBeenCalledWith(mockContext);
      expect(mockService.checkAndLock).toHaveBeenCalledWith('key11', 'custom-fingerprint', expect.any(Object));
    });
  });

  describe('error handling', () => {
    it('should call fail when handler throws error', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key12';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });
      const error = new Error('Handler error');
      mockNext.handle.mockReturnValue(throwError(() => error));

      // When/Then
      try {
        const result = await interceptor.intercept(mockContext, mockNext);
        await new Promise((resolve, reject) => result.subscribe({ next: resolve, error: reject }));
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBe(error);
        expect(mockService.fail).toHaveBeenCalledWith('key12', 'Handler error');
      }
    });
  });

  describe('header caching', () => {
    it('should cache specified headers', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key13';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });
      mockResponse.getHeader.mockReturnValueOnce('application/json').mockReturnValueOnce('custom-value');
      const options: IIdempotentOptions = { cacheHeaders: ['Content-Type', 'X-Custom'] };
      mockReflector.get.mockReturnValue(options);

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.complete).toHaveBeenCalledWith(
        'key13',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json', 'X-Custom': 'custom-value' },
        }),
        expect.any(Object),
      );
    });

    it('should not cache headers when none specified', async () => {
      // Given
      mockRequest.headers['idempotency-key'] = 'key14';
      mockService.checkAndLock.mockResolvedValue({ isNew: true });

      // When
      const result = await interceptor.intercept(mockContext, mockNext);
      await new Promise((resolve) => result.subscribe(resolve));

      // Then
      expect(mockService.complete).toHaveBeenCalledWith(
        'key14',
        expect.objectContaining({
          headers: undefined,
        }),
        expect.any(Object),
      );
    });
  });
});
