import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RateLimit, RATE_LIMIT_OPTIONS, type IRateLimitOptions } from '../../src/rate-limit/api/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../src/rate-limit/api/guards/rate-limit.guard';

describe('@RateLimit Decorator', () => {
  const reflector = new Reflector();

  describe('metadata', () => {
    it('should set rate limit options metadata', () => {
      // Given
      const options: IRateLimitOptions = {
        points: 100,
        duration: 60,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata).toEqual(options);
    });

    it('should set options with algorithm', () => {
      // Given
      const options: IRateLimitOptions = {
        algorithm: 'token-bucket',
        points: 150,
        refillRate: 10,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.algorithm).toBe('token-bucket');
      expect(metadata.points).toBe(150);
      expect(metadata.refillRate).toBe(10);
    });

    it('should set options with custom key', () => {
      // Given
      const options: IRateLimitOptions = {
        key: 'custom-key',
        points: 50,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.key).toBe('custom-key');
    });

    it('should set options with key extractor function', () => {
      // Given
      const keyExtractor = (ctx: any) => `user:${ctx.user.id}`;
      const options: IRateLimitOptions = {
        key: keyExtractor,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(typeof metadata.key).toBe('function');
      expect(metadata.key).toBe(keyExtractor);
    });
  });

  describe('guard attachment', () => {
    it('should apply decorators', () => {
      // Given
      const options: IRateLimitOptions = {
        points: 100,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata).toBeDefined();
      expect(metadata).toEqual(options);
    });
  });

  describe('class decorator', () => {
    it('should apply to class', () => {
      // Given
      const options: IRateLimitOptions = {
        points: 200,
        duration: 120,
      };

      @RateLimit(options)
      class TestClass {
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(RATE_LIMIT_OPTIONS, TestClass);

      // Then
      expect(metadata).toEqual(options);
    });
  });

  describe('default options', () => {
    it('should allow empty options object', () => {
      // Given
      class TestClass {
        @RateLimit({})
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata).toEqual({});
    });

    it('should allow no options', () => {
      // Given
      class TestClass {
        @RateLimit()
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata).toBeDefined();
    });
  });

  describe('multiple decorators', () => {
    it('should allow multiple decorated methods in same class', () => {
      // Given
      const options1: IRateLimitOptions = { points: 10 };
      const options2: IRateLimitOptions = { points: 20 };

      class TestClass {
        @RateLimit(options1)
        method1() {
          return 'one';
        }

        @RateLimit(options2)
        method2() {
          return 'two';
        }
      }

      // When
      const metadata1 = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.method1);
      const metadata2 = reflector.get(RATE_LIMIT_OPTIONS, TestClass.prototype.method2);

      // Then
      expect(metadata1).toEqual(options1);
      expect(metadata2).toEqual(options2);
    });
  });

  describe('algorithm options', () => {
    it('should support fixed-window algorithm', () => {
      // Given
      const options: IRateLimitOptions = {
        algorithm: 'fixed-window',
        points: 100,
        duration: 60,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {}
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.algorithm).toBe('fixed-window');
    });

    it('should support sliding-window algorithm', () => {
      // Given
      const options: IRateLimitOptions = {
        algorithm: 'sliding-window',
        points: 50,
        duration: 30,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {}
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.algorithm).toBe('sliding-window');
    });

    it('should support token-bucket algorithm', () => {
      // Given
      const options: IRateLimitOptions = {
        algorithm: 'token-bucket',
        points: 100,
        refillRate: 10,
      };

      class TestClass {
        @RateLimit(options)
        testMethod() {}
      }

      // When
      const metadata = reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.algorithm).toBe('token-bucket');
      expect(metadata.refillRate).toBe(10);
    });
  });
});
