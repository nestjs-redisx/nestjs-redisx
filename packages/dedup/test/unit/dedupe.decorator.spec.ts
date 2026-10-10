import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { Dedupe, DEDUPE_OPTIONS, registerDedupServiceGetter } from '../../src/dedup/api/decorators/dedupe.decorator';

function createFakeService() {
  // Pass-through dedupe that records calls and runs fn (first-occurrence)
  const dedupe = vi.fn().mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn());
  return { dedupe };
}

describe('@Dedupe decorator', () => {
  beforeEach(() => {
    registerDedupServiceGetter(null);
  });

  describe('runtime behavior', () => {
    it('should route the call through dedupService.dedupe with the built key and window', async () => {
      // Given
      const service = createFakeService();
      registerDedupServiceGetter(() => service as never);

      class Handler {
        @Dedupe({ key: 'webhook:{0}', window: 5_000 })
        async handle(id: string): Promise<string> {
          return `handled:${id}`;
        }
      }

      // When
      const result = await new Handler().handle('evt-1');

      // Then
      expect(result).toBe('handled:evt-1');
      expect(service.dedupe).toHaveBeenCalledWith('webhook:evt-1', expect.any(Function), { window: 5_000 });
    });

    it('should resolve undefined for duplicates (service skips)', async () => {
      // Given — service reports a duplicate
      const service = { dedupe: vi.fn().mockResolvedValue(undefined) };
      registerDedupServiceGetter(() => service as never);
      const body = vi.fn();

      class Handler {
        @Dedupe({ key: 'k' })
        async handle(): Promise<string> {
          body();
          return 'never';
        }
      }

      // When/Then
      expect(await new Handler().handle()).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
    });

    it('should support a key builder function and preserve `this`', async () => {
      // Given
      const service = createFakeService();
      registerDedupServiceGetter(() => service as never);

      class Handler {
        tag = 'self';
        @Dedupe({ key: (event) => `evt:${(event as { id: string }).id}` })
        async handle(event: { id: string }): Promise<string> {
          return `${this.tag}:${event.id}`;
        }
      }

      // When
      const result = await new Handler().handle({ id: '9' });

      // Then
      expect(result).toBe('self:9');
      expect(service.dedupe).toHaveBeenCalledWith('evt:9', expect.any(Function), { window: undefined });
    });

    it('should render missing template arguments as empty strings', async () => {
      // Given
      const service = createFakeService();
      registerDedupServiceGetter(() => service as never);

      class Handler {
        @Dedupe({ key: 'a:{0}:{5}' })
        async handle(first: string): Promise<string> {
          return first;
        }
      }

      // When
      await new Handler().handle('x');

      // Then
      expect(service.dedupe).toHaveBeenCalledWith('a:x:', expect.any(Function), expect.any(Object));
    });

    it('should collapse object template args onto ONE key (and warn once) — the over-dedup footgun made loud', async () => {
      // Given
      const service = createFakeService();
      registerDedupServiceGetter(() => service as never);

      class Handler {
        @Dedupe({ key: 'evt:{0}' })
        async handle(event: unknown): Promise<unknown> {
          return event;
        }
      }

      // When — the DTO (not its id) lands in the template
      await new Handler().handle({ id: 1 });
      await new Handler().handle({ id: 2 });

      // Then — both distinct events share one key (duplicates skipped!)
      expect(service.dedupe).toHaveBeenNthCalledWith(1, 'evt:[object Object]', expect.any(Function), expect.any(Object));
      expect(service.dedupe).toHaveBeenNthCalledWith(2, 'evt:[object Object]', expect.any(Function), expect.any(Object));
    });

    it('should execute WITHOUT deduplication (and warn) when no service is registered', async () => {
      // Given — no plugin
      class Handler {
        @Dedupe({ key: 'k' })
        async handle(): Promise<string> {
          return 'ran-undeduplicated';
        }
      }

      // When/Then — fail-open
      expect(await new Handler().handle()).toBe('ran-undeduplicated');
    });

    it('should execute WITHOUT deduplication when the getter returns null (service torn down)', async () => {
      // Given
      registerDedupServiceGetter((() => null) as never);

      class Handler {
        @Dedupe({ key: 'k' })
        async handle(): Promise<string> {
          return 'ran-undeduplicated';
        }
      }

      // When/Then
      expect(await new Handler().handle()).toBe('ran-undeduplicated');
    });
  });

  describe('metadata', () => {
    it('should preserve the method name and expose options metadata on the wrapper', () => {
      // Given
      class Handler {
        @Dedupe({ key: 'k', window: 1_000 })
        async handle(): Promise<void> {
          /* noop */
        }
      }

      // Then
      const wrapper = Handler.prototype.handle;
      expect(wrapper.name).toBe('handle');
      expect(Reflect.getMetadata(DEDUPE_OPTIONS, wrapper)).toEqual({ key: 'k', window: 1_000 });
    });

    it('should carry metadata stamped by decorators applied before it — @Cron below @Dedupe must not silently unregister the job', async () => {
      // Given
      const CRON_METADATA = 'test:schedule-expression';
      class Handler {
        async job(): Promise<string> {
          return 'ran';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Handler.prototype, 'job')!;
      Reflect.defineMetadata(CRON_METADATA, '0 3 * * *', descriptor.value);

      // When
      Dedupe({ key: 'jobs' })(Handler.prototype, 'job', descriptor);
      Object.defineProperty(Handler.prototype, 'job', descriptor);

      // Then
      const wrapper = Handler.prototype.job;
      expect(Reflect.getMetadata(CRON_METADATA, wrapper)).toBe('0 3 * * *');
      expect(await new Handler().job()).toBe('ran'); // no service → fail-open
    });
  });

  describe('dual-package safety', () => {
    it('should share the service getter with a second copy of the decorator module', async () => {
      // Given
      const service = createFakeService();
      registerDedupServiceGetter(() => service as never);

      // When — the OTHER copy decorates a class
      const secondCopy: typeof import('../../src/dedup/api/decorators/dedupe.decorator') = await import('../../src/dedup/api/decorators/dedupe.decorator?copy=b' as string);
      class Handler {
        async handle(): Promise<string> {
          return 'ok';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Handler.prototype, 'handle')!;
      secondCopy.Dedupe({ key: 'dual' })(Handler.prototype, 'handle', descriptor);
      Object.defineProperty(Handler.prototype, 'handle', descriptor);

      // Then
      expect(secondCopy.Dedupe).not.toBe(Dedupe);
      expect(await new Handler().handle()).toBe('ok');
      expect(service.dedupe).toHaveBeenCalledWith('dual', expect.any(Function), expect.any(Object));
    });
  });
});
