import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { Idempotent, IDEMPOTENT_OPTIONS, type IIdempotentOptions } from '../../src/idempotency/api/decorators/idempotent.decorator';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { IdempotencyInterceptor } from '../../src/idempotency/api/interceptors/idempotency.interceptor';

describe('Idempotent Decorator', () => {
  const reflector = new Reflector();

  describe('metadata', () => {
    it('should set default options when no options provided', () => {
      // Given
      class TestController {
        @Idempotent()
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata).toEqual({});
    });

    it('should set TTL option', () => {
      // Given
      class TestController {
        @Idempotent({ ttl: 3600 })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.ttl).toBe(3600);
    });

    it('should set keyExtractor option', () => {
      // Given
      class TestController {
        @Idempotent({
          keyExtractor: (ctx: ExecutionContext) => 'custom-key',
        })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.keyExtractor).toBeInstanceOf(Function);
    });

    it('should set fingerprintFields option', () => {
      // Given
      class TestController {
        @Idempotent({
          fingerprintFields: ['method', 'path', 'body'],
        })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.fingerprintFields).toEqual(['method', 'path', 'body']);
    });

    it('should set validateFingerprint and cacheHeaders options', () => {
      // Given
      class TestController {
        @Idempotent({
          validateFingerprint: true,
          cacheHeaders: ['Content-Type', 'X-Custom'],
        })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.validateFingerprint).toBe(true);
      expect(metadata.cacheHeaders).toEqual(['Content-Type', 'X-Custom']);
    });

    it('should set skip option', () => {
      // Given
      class TestController {
        @Idempotent({
          skip: (ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user?.isAdmin === true,
        })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.skip).toBeInstanceOf(Function);
    });

    it('should set all options together', () => {
      // Given
      class TestController {
        @Idempotent({
          ttl: 7200,
          keyExtractor: (ctx: ExecutionContext) => 'key',
          fingerprintFields: ['method', 'body'],
          validateFingerprint: true,
          cacheHeaders: ['X-Custom'],
          skip: () => false,
        })
        testMethod() {
          return 'ok';
        }
      }

      // When
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);

      // Then
      expect(metadata.ttl).toBe(7200);
      expect(metadata.keyExtractor).toBeInstanceOf(Function);
      expect(metadata.fingerprintFields).toEqual(['method', 'body']);
      expect(metadata.validateFingerprint).toBe(true);
      expect(metadata.cacheHeaders).toEqual(['X-Custom']);
      expect(metadata.skip).toBeInstanceOf(Function);
    });
  });

  describe('interceptor attachment', () => {
    it('should attach IdempotencyInterceptor to method', () => {
      // Given
      class TestController {
        @Idempotent()
        testMethod() {
          return 'ok';
        }
      }

      // When
      const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, TestController.prototype.testMethod);

      // Then
      expect(interceptors).toHaveLength(1);
      expect(interceptors[0]).toBe(IdempotencyInterceptor);
    });
  });

  describe('function options', () => {
    it('should allow keyExtractor function to return string', () => {
      // Given
      class TestController {
        @Idempotent({
          keyExtractor: (ctx: ExecutionContext) => 'custom-key',
        })
        testMethod() {
          return 'ok';
        }
      }
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);
      const mockContext = {
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user123' } }) }),
      } as ExecutionContext;

      // When
      const result = metadata.keyExtractor!(mockContext);

      // Then
      expect(result).toBe('custom-key');
    });

    it('should allow skip function to return boolean', () => {
      // Given
      class TestController {
        @Idempotent({
          skip: (ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user?.isAdmin === true,
        })
        testMethod() {
          return 'ok';
        }
      }
      const metadata = reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, TestController.prototype.testMethod);
      const mockContextAdmin = {
        switchToHttp: () => ({ getRequest: () => ({ user: { isAdmin: true } }) }),
      } as ExecutionContext;
      const mockContextUser = {
        switchToHttp: () => ({ getRequest: () => ({ user: { isAdmin: false } }) }),
      } as ExecutionContext;

      // When
      const resultAdmin = metadata.skip!(mockContextAdmin);
      const resultUser = metadata.skip!(mockContextUser);

      // Then
      expect(resultAdmin).toBe(true);
      expect(resultUser).toBe(false);
    });
  });
});
