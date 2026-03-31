import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { WithLock, WITH_LOCK_OPTIONS, registerLockServiceGetter, type IWithLockOptions } from '../../src/lock/api/decorators/with-lock.decorator';
import { LockAcquisitionError } from '../../src/shared/errors';

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

  describe('runtime behavior', () => {
    let mockLock: { release: ReturnType<typeof vi.fn> };
    let mockLockService: { acquire: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockLock = { release: vi.fn().mockResolvedValue(undefined) };
      mockLockService = { acquire: vi.fn().mockResolvedValue(mockLock) };
      registerLockServiceGetter(() => mockLockService);
    });

    afterEach(() => {
      registerLockServiceGetter(null as any);
    });

    it('should acquire lock, execute method, and release lock', async () => {
      // Given
      class TestService {
        @WithLock({ key: 'my-lock' })
        async doWork() {
          return 'result';
        }
      }
      const service = new TestService();

      // When
      const result = await service.doWork();

      // Then
      expect(result).toBe('result');
      expect(mockLockService.acquire).toHaveBeenCalledWith('my-lock', {
        ttl: undefined,
        waitTimeout: undefined,
        autoRenew: undefined,
      });
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('should pass ttl, waitTimeout, autoRenew to acquire', async () => {
      // Given
      class TestService {
        @WithLock({ key: 'k', ttl: 5000, waitTimeout: 2000, autoRenew: true })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      await service.doWork();

      // Then
      expect(mockLockService.acquire).toHaveBeenCalledWith('k', {
        ttl: 5000,
        waitTimeout: 2000,
        autoRenew: true,
      });
    });

    it('should execute without lock when no getter registered', async () => {
      // Given
      registerLockServiceGetter(null as any);
      class TestService {
        @WithLock({ key: 'k' })
        async doWork() {
          return 'no-lock';
        }
      }
      const service = new TestService();

      // When
      const result = await service.doWork();

      // Then
      expect(result).toBe('no-lock');
      expect(mockLockService.acquire).not.toHaveBeenCalled();
    });

    it('should execute without lock when getter returns null', async () => {
      // Given
      registerLockServiceGetter(() => null as any);
      class TestService {
        @WithLock({ key: 'k' })
        async doWork() {
          return 'fallback';
        }
      }
      const service = new TestService();

      // When
      const result = await service.doWork();

      // Then
      expect(result).toBe('fallback');
    });

    it('should throw LockAcquisitionError by default (onLockFailed=throw)', async () => {
      // Given
      const error = new LockAcquisitionError('my-lock', 'timeout');
      mockLockService.acquire.mockRejectedValue(error);
      class TestService {
        @WithLock({ key: 'my-lock' })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When/Then
      await expect(service.doWork()).rejects.toThrow(LockAcquisitionError);
    });

    it('should return undefined when onLockFailed=skip', async () => {
      // Given
      const error = new LockAcquisitionError('k', 'held');
      mockLockService.acquire.mockRejectedValue(error);
      class TestService {
        @WithLock({ key: 'k', onLockFailed: 'skip' })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      const result = await service.doWork();

      // Then
      expect(result).toBeUndefined();
    });

    it('should throw custom error when onLockFailed is a function', async () => {
      // Given
      const error = new LockAcquisitionError('k', 'held');
      mockLockService.acquire.mockRejectedValue(error);
      class TestService {
        @WithLock({ key: 'k', onLockFailed: (key) => new Error(`Custom: ${key}`) })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When/Then
      await expect(service.doWork()).rejects.toThrow('Custom: k');
    });

    it('should rethrow non-LockAcquisitionError errors', async () => {
      // Given
      mockLockService.acquire.mockRejectedValue(new Error('network'));
      class TestService {
        @WithLock({ key: 'k' })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When/Then
      await expect(service.doWork()).rejects.toThrow('network');
    });

    it('should release lock even when method throws', async () => {
      // Given
      class TestService {
        @WithLock({ key: 'k' })
        async doWork() {
          throw new Error('method-error');
        }
      }
      const service = new TestService();

      // When/Then
      await expect(service.doWork()).rejects.toThrow('method-error');
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('should log error and not throw when release fails', async () => {
      // Given
      mockLock.release.mockRejectedValue(new Error('release-fail'));
      class TestService {
        @WithLock({ key: 'k' })
        async doWork() {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      const result = await service.doWork();

      // Then — should not throw, method result returned
      expect(result).toBe('ok');
    });

    it('should interpolate positional key template {0}', async () => {
      // Given
      class TestService {
        @WithLock({ key: 'user:{0}' })
        async doWork(_userId: string) {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      await service.doWork('abc123');

      // Then
      expect(mockLockService.acquire).toHaveBeenCalledWith('user:abc123', expect.any(Object));
    });

    it('should interpolate object property key template {0.id}', async () => {
      // Given
      class TestService {
        @WithLock({ key: 'order:{0.id}' })
        async doWork(_dto: { id: string }) {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      await service.doWork({ id: 'ord-99' });

      // Then
      expect(mockLockService.acquire).toHaveBeenCalledWith('order:ord-99', expect.any(Object));
    });

    it('should use function key builder', async () => {
      // Given
      class TestService {
        @WithLock({ key: (dto: any) => `custom:${dto.name}` })
        async doWork(_dto: { name: string }) {
          return 'ok';
        }
      }
      const service = new TestService();

      // When
      await service.doWork({ name: 'test' });

      // Then
      expect(mockLockService.acquire).toHaveBeenCalledWith('custom:test', expect.any(Object));
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
