import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { WithLock, WITH_LOCK_OPTIONS, type IWithLockOptions } from '../../src/lock/api/decorators/with-lock.decorator';

describe('@WithLock Decorator', () => {
  const reflector = new Reflector();

  describe('metadata', () => {
    it('should set lock options metadata', () => {
      // Given
      const options: IWithLockOptions = {
        key: 'test-lock',
        ttl: 30000,
      };

      class TestClass {
        @WithLock(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata).toEqual(options);
    });

    it('should set lock options with function key', () => {
      // Given
      const keyFn = (arg: string) => `lock:${arg}`;
      const options: IWithLockOptions = {
        key: keyFn,
        ttl: 60000,
        autoRenew: true,
      };

      class TestClass {
        @WithLock(options)
        testMethod(_arg: string) {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.key).toBe(keyFn);
      expect(metadata.ttl).toBe(60000);
      expect(metadata.autoRenew).toBe(true);
    });

    it('should set lock options with onLockFailed as string', () => {
      // Given
      const options: IWithLockOptions = {
        key: 'test-lock',
        onLockFailed: 'skip',
      };

      class TestClass {
        @WithLock(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.onLockFailed).toBe('skip');
    });

    it('should set lock options with onLockFailed as function', () => {
      // Given
      const errorFn = (key: string) => new Error(`Failed for ${key}`);
      const options: IWithLockOptions = {
        key: 'test-lock',
        onLockFailed: errorFn,
      };

      class TestClass {
        @WithLock(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.onLockFailed).toBe(errorFn);
    });

    it('should set lock options with waitTimeout', () => {
      // Given
      const options: IWithLockOptions = {
        key: 'test-lock',
        waitTimeout: 5000,
      };

      class TestClass {
        @WithLock(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.waitTimeout).toBe(5000);
    });
  });

  describe('multiple decorators', () => {
    it('should allow multiple decorated methods in same class', () => {
      // Given
      const options1: IWithLockOptions = { key: 'lock1' };
      const options2: IWithLockOptions = { key: 'lock2', ttl: 60000 };

      class TestClass {
        @WithLock(options1)
        method1() {
          return 'one';
        }

        @WithLock(options2)
        method2() {
          return 'two';
        }
      }

      // When
      const metadata1 = reflector.get(WITH_LOCK_OPTIONS, TestClass.prototype.method1);
      const metadata2 = reflector.get(WITH_LOCK_OPTIONS, TestClass.prototype.method2);

      // Then
      expect(metadata1).toEqual(options1);
      expect(metadata2).toEqual(options2);
    });
  });

  describe('key patterns', () => {
    it('should support string key', () => {
      // Given
      const options: IWithLockOptions = {
        key: 'static-key',
      };

      class TestClass {
        @WithLock(options)
        testMethod() {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.key).toBe('static-key');
    });

    it('should support template string key pattern', () => {
      // Given
      const options: IWithLockOptions = {
        key: 'user:{0}',
      };

      class TestClass {
        @WithLock(options)
        testMethod(_userId: string) {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(metadata.key).toBe('user:{0}');
    });

    it('should support function key builder', () => {
      // Given
      const keyBuilder = (userId: string, action: string) => `${action}:${userId}`;
      const options: IWithLockOptions = {
        key: keyBuilder,
      };

      class TestClass {
        @WithLock(options)
        testMethod(_userId: string, _action: string) {
          return 'test';
        }
      }

      // When
      const metadata = reflector.get<IWithLockOptions>(WITH_LOCK_OPTIONS, TestClass.prototype.testMethod);

      // Then
      expect(typeof metadata.key).toBe('function');
      expect(metadata.key).toBe(keyBuilder);
    });
  });
});
