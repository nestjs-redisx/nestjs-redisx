import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { WithSemaphore, WITH_SEMAPHORE_OPTIONS, registerSemaphoreServiceGetter } from '../../src/semaphore/api/decorators/with-semaphore.decorator';
import { SemaphoreAcquisitionError } from '../../src/shared/errors';

function createFakeService() {
  const release = vi.fn().mockResolvedValue(undefined);
  const acquire = vi.fn().mockResolvedValue({ release });
  return { acquire, release };
}

describe('@WithSemaphore decorator', () => {
  beforeEach(() => {
    registerSemaphoreServiceGetter(null);
  });

  describe('runtime behavior', () => {
    it('should acquire a permit, run the method, and release', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: 'renders', permits: 3, ttl: 5_000 })
        async work(): Promise<string> {
          return 'done';
        }
      }

      // When
      const result = await new Worker().work();

      // Then
      expect(result).toBe('done');
      expect(service.acquire).toHaveBeenCalledWith('renders', 3, { ttl: 5_000, waitTimeout: undefined, autoRenew: undefined });
      expect(service.release).toHaveBeenCalledTimes(1);
    });

    it('should release even when the method throws, and rethrow', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1 })
        async work(): Promise<never> {
          throw new Error('boom');
        }
      }

      // When/Then
      await expect(new Worker().work()).rejects.toThrow('boom');
      expect(service.release).toHaveBeenCalledTimes(1);
    });

    it('should interpolate {n} placeholders from arguments', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: 'export:{0}:{1}', permits: 2 })
        async export(tenant: string, kind: string): Promise<string> {
          return `${tenant}/${kind}`;
        }
      }

      // When
      await new Worker().export('acme', 'pdf');

      // Then
      expect(service.acquire).toHaveBeenCalledWith('export:acme:pdf', 2, expect.any(Object));
    });

    it('should render missing template arguments as empty strings', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: 'a:{0}:{5}', permits: 1 })
        async run(first: string): Promise<string> {
          return first;
        }
      }

      // When
      await new Worker().run('x');

      // Then - index 5 has no argument
      expect(service.acquire).toHaveBeenCalledWith('a:x:', 1, expect.any(Object));
    });

    it('should support a key builder function', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: (dto: unknown) => `tenant:${(dto as { id: string }).id}`, permits: 1 })
        async run(dto: { id: string }): Promise<string> {
          return dto.id;
        }
      }

      // When
      await new Worker().run({ id: 't-7' });

      // Then
      expect(service.acquire).toHaveBeenCalledWith('tenant:t-7', 1, expect.any(Object));
    });

    it('should execute WITHOUT a bound when the getter returns null (service torn down)', async () => {
      // Given - a registered getter whose service is gone
      registerSemaphoreServiceGetter((() => null) as never);

      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1 })
        async work(): Promise<string> {
          return 'ran-unbounded';
        }
      }

      // When/Then
      expect(await new Worker().work()).toBe('ran-unbounded');
    });

    it('should execute WITHOUT a bound (and warn) when no service is registered - fail-open, not fail-skip', async () => {
      // Given - no plugin registered
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1 })
        async work(): Promise<string> {
          return 'ran-unbounded';
        }
      }

      // When/Then - business method still runs
      expect(await new Worker().work()).toBe('ran-unbounded');
    });
  });

  describe('onUnavailable policy', () => {
    function saturatedService() {
      return {
        acquire: vi.fn().mockRejectedValue(new SemaphoreAcquisitionError('renders', 'timeout')),
      };
    }

    it('should rethrow by default', async () => {
      // Given
      registerSemaphoreServiceGetter(() => saturatedService() as never);
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1 })
        async work(): Promise<string> {
          return 'never';
        }
      }

      // When/Then
      await expect(new Worker().work()).rejects.toThrow(SemaphoreAcquisitionError);
    });

    it("should skip the method with 'skip'", async () => {
      // Given
      registerSemaphoreServiceGetter(() => saturatedService() as never);
      const body = vi.fn();
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: 'skip' })
        async work(): Promise<string> {
          body();
          return 'never';
        }
      }

      // When
      const result = await new Worker().work();

      // Then
      expect(result).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
    });

    it('should throw the custom error from a function policy', async () => {
      // Given
      registerSemaphoreServiceGetter(() => saturatedService() as never);
      class TooBusyError extends Error {}
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: (key) => new TooBusyError(`busy: ${key}`) })
        async work(): Promise<string> {
          return 'never';
        }
      }

      // When/Then
      await expect(new Worker().work()).rejects.toThrow(TooBusyError);
    });

    it('should NOT apply the policy to a method failure after acquisition (only to acquisition)', async () => {
      // Given - acquisition succeeds, the METHOD throws an acquisition-shaped error
      const service = createFakeService();
      service.acquire.mockResolvedValue({ release: service.release });
      registerSemaphoreServiceGetter(() => service as never);

      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: 'skip' })
        async work(): Promise<never> {
          throw new SemaphoreAcquisitionError('inner', 'error');
        }
      }

      // When/Then - the method's own error surfaces; skip-policy must not eat it
      await expect(new Worker().work()).rejects.toThrow(SemaphoreAcquisitionError);
      expect(service.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('adversarial: policy totality and cross-copy errors', () => {
    it('should fall back to the ORIGINAL error when a custom policy returns a non-Error (never `throw undefined`)', async () => {
      // Given - a policy written as a logger, returning nothing
      registerSemaphoreServiceGetter(() => ({ acquire: vi.fn().mockRejectedValue(new SemaphoreAcquisitionError('renders', 'exhausted')) }) as never);
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: (() => undefined) as never })
        async work(): Promise<string> {
          return 'never';
        }
      }

      // When/Then - the acquisition error surfaces, not `undefined`
      await expect(new Worker().work()).rejects.toThrow(SemaphoreAcquisitionError);
    });

    it('should apply the policy to a CROSS-COPY acquisition error (code match, not instanceof)', async () => {
      // Given - the service was loaded from the OTHER module copy: same
      // shape and code, different class identity
      const foreignError = Object.assign(new Error('Failed to acquire semaphore permit for "renders": exhausted'), { code: 'SEMAPHORE_ACQUISITION_FAILED' });
      registerSemaphoreServiceGetter(() => ({ acquire: vi.fn().mockRejectedValue(foreignError) }) as never);
      const body = vi.fn();
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: 'skip' })
        async work(): Promise<string> {
          body();
          return 'never';
        }
      }

      // When/Then - skip engages instead of a raw rethrow through a 'skip' cron
      expect(await new Worker().work()).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
    });

    it('should engage the policy on a store OUTAGE too (typed error with reason error)', async () => {
      // Given
      registerSemaphoreServiceGetter(() => ({ acquire: vi.fn().mockRejectedValue(new SemaphoreAcquisitionError('renders', 'error', new Error('READONLY'))) }) as never);
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 1, onUnavailable: 'skip' })
        async work(): Promise<string> {
          return 'never';
        }
      }

      // When/Then
      expect(await new Worker().work()).toBeUndefined();
    });

    it('should warn once when a {n} template interpolates an object (all calls share ONE key)', async () => {
      // Given
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);
      class Worker {
        @WithSemaphore({ key: 'export:{0}', permits: 1 })
        async run(dto: unknown): Promise<unknown> {
          return dto;
        }
      }

      // When - object interpolation
      await new Worker().run({ id: 1 });
      await new Worker().run({ id: 2 });

      // Then - both calls collapsed onto one key
      expect(service.acquire).toHaveBeenNthCalledWith(1, 'export:[object Object]', 1, expect.any(Object));
      expect(service.acquire).toHaveBeenNthCalledWith(2, 'export:[object Object]', 1, expect.any(Object));
    });
  });

  describe('metadata', () => {
    it('should preserve the method name and expose options metadata on the wrapper', () => {
      // Given
      class Worker {
        @WithSemaphore({ key: 'renders', permits: 4 })
        async render(): Promise<void> {
          /* noop */
        }
      }

      // Then
      const wrapper = Worker.prototype.render;
      expect(wrapper.name).toBe('render');
      expect(Reflect.getMetadata(WITH_SEMAPHORE_OPTIONS, wrapper)).toEqual({ key: 'renders', permits: 4 });
    });

    it('should carry metadata stamped by decorators applied before it - @Cron below @WithSemaphore must not silently unregister the job', async () => {
      // Given - a method already stamped by an earlier decorator
      const CRON_METADATA = 'test:schedule-expression';
      class Worker {
        async job(): Promise<string> {
          return 'ran';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'job')!;
      Reflect.defineMetadata(CRON_METADATA, '0 3 * * *', descriptor.value);

      // When
      WithSemaphore({ key: 'jobs', permits: 1 })(Worker.prototype, 'job', descriptor);
      Object.defineProperty(Worker.prototype, 'job', descriptor);

      // Then - the wrapper carries the earlier decorator's metadata and still
      // runs fail-open without a service
      const wrapper = Worker.prototype.job;
      expect(Reflect.getMetadata(CRON_METADATA, wrapper)).toBe('0 3 * * *');
      expect(await new Worker().job()).toBe('ran');
    });
  });

  describe('dual-package safety', () => {
    it('should share the service getter with a second copy of the decorator module', async () => {
      // Given - a second, independent module instance (the ?copy query forces
      // Vite to instantiate it again), standing in for the CJS/ESM pair.
      const service = createFakeService();
      registerSemaphoreServiceGetter(() => service as never);

      // When - the OTHER copy defines a decorated class
      const secondCopy: typeof import('../../src/semaphore/api/decorators/with-semaphore.decorator') = await import('../../src/semaphore/api/decorators/with-semaphore.decorator?copy=b' as string);
      class Worker {
        async work(): Promise<string> {
          return 'ok';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'work')!;
      secondCopy.WithSemaphore({ key: 'dual', permits: 1 })(Worker.prototype, 'work', descriptor);
      Object.defineProperty(Worker.prototype, 'work', descriptor);

      // Then - the copy sees the getter registered through THIS module
      expect(secondCopy.WithSemaphore).not.toBe(WithSemaphore);
      expect(await new Worker().work()).toBe('ok');
      expect(service.acquire).toHaveBeenCalledWith('dual', 1, expect.any(Object));
    });
  });
});
