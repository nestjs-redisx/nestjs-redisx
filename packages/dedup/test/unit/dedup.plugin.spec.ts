import { describe, it, expect, vi } from 'vitest';
import { DedupPlugin } from '../../src/dedup.plugin';
import { InvalidDedupConfigError } from '../../src/shared/errors';
import { DEDUP_PLUGIN_OPTIONS, DEDUP_REDIS_DRIVER, DEDUP_SERVICE, DEDUP_STORE } from '../../src/shared/constants';

type FactoryProvider = { provide: unknown; useFactory: (...args: unknown[]) => unknown; inject?: unknown[] };
type ValueProvider = { provide: unknown; useValue: unknown };

function findProvider(plugin: DedupPlugin, token: unknown): unknown {
  return plugin.getProviders().find((p) => (p as { provide?: unknown }).provide === token);
}

describe('DedupPlugin', () => {
  it('should expose name, semver version, and description', () => {
    const plugin = new DedupPlugin();
    expect(plugin.name).toBe('dedup');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(plugin.description.toLowerCase()).toContain('dedup');
  });

  it('should provide options, driver, store, service, and the decorator initializer', () => {
    const plugin = new DedupPlugin();
    expect(findProvider(plugin, DEDUP_PLUGIN_OPTIONS)).toBeDefined();
    expect(findProvider(plugin, DEDUP_REDIS_DRIVER)).toBeDefined();
    expect(findProvider(plugin, DEDUP_STORE)).toBeDefined();
    expect(findProvider(plugin, DEDUP_SERVICE)).toBeDefined();
    expect(plugin.getExports()).toContain(DEDUP_SERVICE);
  });

  it('should merge defaults into the sync options value', () => {
    const plugin = new DedupPlugin({ defaultWindow: 5_000 });
    const provider = findProvider(plugin, DEDUP_PLUGIN_OPTIONS) as ValueProvider;
    const options = provider.useValue as Record<string, unknown>;
    expect(options.defaultWindow).toBe(5_000);
    expect(options.keyPrefix).toBe('_dedup:');
    expect(options.errorPolicy).toBe('fail-open');
  });

  it('should fail fast on an invalid sync config', () => {
    expect(() => new DedupPlugin({ errorPolicy: 'explode' as never }).getProviders()).toThrow(InvalidDedupConfigError);
  });

  it('should merge and validate the registerAsync factory result too', async () => {
    const plugin = DedupPlugin.registerAsync({ useFactory: () => ({ defaultWindow: 2_000 }) });
    const provider = findProvider(plugin, DEDUP_PLUGIN_OPTIONS) as FactoryProvider;
    const options = (await provider.useFactory()) as Record<string, unknown>;
    expect(options.defaultWindow).toBe(2_000);
    expect(options.keyPrefix).toBe('_dedup:');

    const bad = DedupPlugin.registerAsync({ useFactory: () => ({ defaultWindow: -1 }) });
    const badProvider = findProvider(bad, DEDUP_PLUGIN_OPTIONS) as FactoryProvider;
    await expect(Promise.resolve(badProvider.useFactory())).rejects.toThrow(InvalidDedupConfigError);
  });

  it('should pass async imports through getImports', () => {
    class FakeModule {}
    const plugin = DedupPlugin.registerAsync({ imports: [FakeModule], useFactory: () => ({}) });
    expect(plugin.getImports()).toEqual([FakeModule]);
    expect(new DedupPlugin().getImports()).toEqual([]);
  });

  it('should resolve the named client and fail helpfully when missing', async () => {
    const plugin = new DedupPlugin({ client: 'events' });
    const provider = findProvider(plugin, DEDUP_REDIS_DRIVER) as FactoryProvider;

    const driver = { id: 'driver' };
    const manager = { getClient: vi.fn().mockResolvedValue(driver) };
    expect(await provider.useFactory(manager, undefined, { client: 'events' })).toBe(driver);

    const broken = { getClient: vi.fn().mockRejectedValue(new Error('nope')) };
    await expect(provider.useFactory(broken, undefined, { client: 'events' })).rejects.toThrow(/Redis client "events" not found/);
  });
});
