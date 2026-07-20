import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { WithCircuitBreaker, WITH_CIRCUIT_BREAKER_OPTIONS, registerCircuitBreakerServiceGetter } from '../../src/circuit-breaker/api/decorators/with-circuit-breaker.decorator';

interface FakeService {
  execute: ReturnType<typeof vi.fn>;
}

/** Fake service that permits the call (runs fn, honoring fallback if execute is told to reject). */
function passthroughService(): FakeService {
  return { execute: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()) };
}

/** Fake service that always rejects, invoking the fallback when provided. */
function rejectingService(): FakeService {
  return {
    execute: vi.fn(async (_key: string, _fn: () => Promise<unknown>, opts?: { fallback?: () => unknown }) => {
      if (opts?.fallback) {
        return opts.fallback();
      }
      throw new Error('circuit open');
    }),
  };
}

describe('WithCircuitBreaker decorator', () => {
  beforeEach(() => {
    // Reset to a permissive service before each test.
    registerCircuitBreakerServiceGetter(() => passthroughService());
  });

  it('should wrap the method, route through execute with the interpolated key, and pass args through', async () => {
    // Given
    const fake = passthroughService();
    registerCircuitBreakerServiceGetter(() => fake);

    class Api {
      @WithCircuitBreaker({ key: 'user:{0}', failureThreshold: 7 })
      async getUser(id: string): Promise<string> {
        return `user-${id}`;
      }
    }

    // When
    const result = await new Api().getUser('42');

    // Then
    expect(result).toBe('user-42');
    expect(fake.execute).toHaveBeenCalledTimes(1);
    const [key, fn, opts] = fake.execute.mock.calls[0];
    expect(key).toBe('user:42');
    expect(typeof fn).toBe('function');
    expect(opts).toMatchObject({ failureThreshold: 7 });
  });

  it('should support a function key builder receiving the arguments', async () => {
    // Given
    const fake = passthroughService();
    registerCircuitBreakerServiceGetter(() => fake);

    class Api {
      @WithCircuitBreaker({ key: (dto: { tenantId: string }) => `tenant:${dto.tenantId}` })
      async run(dto: { tenantId: string }): Promise<string> {
        return dto.tenantId;
      }
    }

    // When
    await new Api().run({ tenantId: 't1' });

    // Then
    expect(fake.execute.mock.calls[0][0]).toBe('tenant:t1');
  });

  it('should return the fallback result when the breaker rejects the call', async () => {
    // Given
    registerCircuitBreakerServiceGetter(() => rejectingService());
    const original = vi.fn().mockResolvedValue('real');

    class Api {
      @WithCircuitBreaker({ key: 'svc', fallback: () => 'fallback' })
      async call(): Promise<string> {
        return original();
      }
    }

    // When
    const result = await new Api().call();

    // Then
    expect(result).toBe('fallback');
    expect(original).not.toHaveBeenCalled();
  });

  it('should resolve to undefined when onOpen is "skip" and the breaker rejects', async () => {
    // Given
    registerCircuitBreakerServiceGetter(() => rejectingService());

    class Api {
      @WithCircuitBreaker({ key: 'svc', onOpen: 'skip' })
      async call(): Promise<string> {
        return 'real';
      }
    }

    // When
    const result = await new Api().call();

    // Then
    expect(result).toBeUndefined();
  });

  it('should execute the method directly when no service is available', async () => {
    // Given — getter returns null (service not ready)
    registerCircuitBreakerServiceGetter(() => null as unknown as FakeService);

    class Api {
      @WithCircuitBreaker({ key: 'svc' })
      async call(): Promise<string> {
        return 'direct';
      }
    }

    // When
    const result = await new Api().call();

    // Then
    expect(result).toBe('direct');
  });

  it('should store options metadata on the wrapper for reflection', () => {
    // Given
    class Api {
      @WithCircuitBreaker({ key: 'svc', windowMs: 1234 })
      async call(): Promise<void> {}
    }

    // When
    const metadata = Reflect.getMetadata(WITH_CIRCUIT_BREAKER_OPTIONS, Api.prototype.call);

    // Then
    expect(metadata).toMatchObject({ key: 'svc', windowMs: 1234 });
  });
});
