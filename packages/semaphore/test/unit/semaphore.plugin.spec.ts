import { describe, it, expect, vi } from 'vitest';
import { SemaphorePlugin } from '../../src/semaphore.plugin';
import { InvalidSemaphoreConfigError } from '../../src/shared/errors';
import { SEMAPHORE_PLUGIN_OPTIONS, SEMAPHORE_REDIS_DRIVER, SEMAPHORE_SERVICE, SEMAPHORE_STORE } from '../../src/shared/constants';

type FactoryProvider = { provide: unknown; useFactory: (...args: unknown[]) => unknown; inject?: unknown[] };
type ValueProvider = { provide: unknown; useValue: unknown };

function findProvider(plugin: SemaphorePlugin, token: unknown): unknown {
  return plugin.getProviders().find((p) => (p as { provide?: unknown }).provide === token);
}

describe('SemaphorePlugin', () => {
  describe('identity', () => {
    it('should expose name, semver version, and description', () => {
      // Given/When
      const plugin = new SemaphorePlugin();

      // Then
      expect(plugin.name).toBe('semaphore');
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(plugin.description).toContain('semaphore');
    });
  });

  describe('providers', () => {
    it('should provide options, driver, store, service, and the decorator initializer', () => {
      // Given/When
      const plugin = new SemaphorePlugin();

      // Then
      expect(findProvider(plugin, SEMAPHORE_PLUGIN_OPTIONS)).toBeDefined();
      expect(findProvider(plugin, SEMAPHORE_REDIS_DRIVER)).toBeDefined();
      expect(findProvider(plugin, SEMAPHORE_STORE)).toBeDefined();
      expect(findProvider(plugin, SEMAPHORE_SERVICE)).toBeDefined();
      expect(plugin.getExports()).toContain(SEMAPHORE_SERVICE);
    });

    it('should merge defaults into the sync options value', () => {
      // Given/When
      const plugin = new SemaphorePlugin({ defaultTtl: 10_000 });
      const provider = findProvider(plugin, SEMAPHORE_PLUGIN_OPTIONS) as ValueProvider;
      const options = provider.useValue as Record<string, unknown>;

      // Then — defaults filled, override kept
      expect(options.defaultTtl).toBe(10_000);
      expect(options.keyPrefix).toBe('_sem:');
      expect(options.maxTtl).toBe(300_000);
      expect((options.retry as Record<string, unknown>).maxRetries).toBe(3);
      expect((options.autoRenew as Record<string, unknown>).enabled).toBe(true);
    });

    it('should fail fast on an invalid sync config at registration time', () => {
      // Given/When/Then — getProviders runs mergeDefaults + validation
      expect(() => new SemaphorePlugin({ defaultTtl: -1 }).getProviders()).toThrow(InvalidSemaphoreConfigError);
    });
  });

  describe('registerAsync', () => {
    it('should merge and validate the factory result too', async () => {
      // Given
      const plugin = SemaphorePlugin.registerAsync({
        useFactory: () => ({ defaultTtl: 5_000 }),
      });
      const provider = findProvider(plugin, SEMAPHORE_PLUGIN_OPTIONS) as FactoryProvider;

      // When
      const options = (await provider.useFactory()) as Record<string, unknown>;

      // Then
      expect(options.defaultTtl).toBe(5_000);
      expect(options.keyPrefix).toBe('_sem:');
    });

    it('should fail fast when the async factory returns an invalid config', async () => {
      // Given
      const plugin = SemaphorePlugin.registerAsync({
        useFactory: () => ({ autoRenew: { intervalFraction: 2 } }),
      });
      const provider = findProvider(plugin, SEMAPHORE_PLUGIN_OPTIONS) as FactoryProvider;

      // When/Then
      await expect(Promise.resolve(provider.useFactory())).rejects.toThrow(InvalidSemaphoreConfigError);
    });

    it('should pass async imports through getImports', () => {
      // Given
      class FakeModule {}
      const plugin = SemaphorePlugin.registerAsync({
        imports: [FakeModule],
        useFactory: () => ({}),
      });

      // Then
      expect(plugin.getImports()).toEqual([FakeModule]);
      expect(new SemaphorePlugin().getImports()).toEqual([]);
    });
  });

  describe('named client resolution', () => {
    it('should resolve the configured client through the manager', async () => {
      // Given
      const plugin = new SemaphorePlugin({ client: 'sem' });
      const provider = findProvider(plugin, SEMAPHORE_REDIS_DRIVER) as FactoryProvider;
      const driver = { id: 'driver' };
      const manager = { getClient: vi.fn().mockResolvedValue(driver) };

      // When
      const resolved = await provider.useFactory(manager, undefined, { client: 'sem' });

      // Then
      expect(resolved).toBe(driver);
      expect(manager.getClient).toHaveBeenCalledWith('sem');
    });

    it('should throw a helpful error when the named client does not exist', async () => {
      // Given
      const plugin = new SemaphorePlugin({ client: 'missing' });
      const provider = findProvider(plugin, SEMAPHORE_REDIS_DRIVER) as FactoryProvider;
      const manager = { getClient: vi.fn().mockRejectedValue(new Error('not found')) };

      // When/Then
      await expect(provider.useFactory(manager, undefined, { client: 'missing' })).rejects.toThrow(/Redis client "missing" not found/);
    });
  });
});
