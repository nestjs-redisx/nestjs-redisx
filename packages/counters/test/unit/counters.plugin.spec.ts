import { describe, it, expect, vi } from 'vitest';
import { CountersPlugin } from '../../src/counters.plugin';
import { InvalidCounterConfigError } from '../../src/shared/errors';
import { COUNTERS_PLUGIN_OPTIONS, COUNTERS_REDIS_DRIVER, COUNTER_SERVICE, COUNTER_STORE } from '../../src/shared/constants';

type FactoryProvider = { provide: unknown; useFactory: (...args: unknown[]) => unknown; inject?: unknown[] };
type ValueProvider = { provide: unknown; useValue: unknown };

function findProvider(plugin: CountersPlugin, token: unknown): unknown {
  return plugin.getProviders().find((p) => (p as { provide?: unknown }).provide === token);
}

describe('CountersPlugin', () => {
  it('should expose name, semver version, and description', () => {
    const plugin = new CountersPlugin();
    expect(plugin.name).toBe('counters');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(plugin.description.toLowerCase()).toContain('counter');
  });

  it('should provide options, driver, store, and service', () => {
    const plugin = new CountersPlugin();
    expect(findProvider(plugin, COUNTERS_PLUGIN_OPTIONS)).toBeDefined();
    expect(findProvider(plugin, COUNTERS_REDIS_DRIVER)).toBeDefined();
    expect(findProvider(plugin, COUNTER_STORE)).toBeDefined();
    expect(findProvider(plugin, COUNTER_SERVICE)).toBeDefined();
    expect(plugin.getExports()).toContain(COUNTER_SERVICE);
  });

  it('should merge defaults and fail fast on invalid sync config', () => {
    const plugin = new CountersPlugin({});
    const provider = findProvider(plugin, COUNTERS_PLUGIN_OPTIONS) as ValueProvider;
    expect((provider.useValue as Record<string, unknown>).keyPrefix).toBe('_ctr:');

    expect(() => new CountersPlugin({ keyPrefix: '' }).getProviders()).toThrow(InvalidCounterConfigError);
  });

  it('should merge and validate the registerAsync factory result too', async () => {
    const plugin = CountersPlugin.registerAsync({ useFactory: () => ({ keyPrefix: 'c:' }) });
    const provider = findProvider(plugin, COUNTERS_PLUGIN_OPTIONS) as FactoryProvider;
    expect(((await provider.useFactory()) as Record<string, unknown>).keyPrefix).toBe('c:');

    const bad = CountersPlugin.registerAsync({ useFactory: () => ({ keyPrefix: '' }) });
    const badProvider = findProvider(bad, COUNTERS_PLUGIN_OPTIONS) as FactoryProvider;
    await expect(Promise.resolve(badProvider.useFactory())).rejects.toThrow(InvalidCounterConfigError);
  });

  it('should pass async imports through getImports', () => {
    class FakeModule {}
    expect(CountersPlugin.registerAsync({ imports: [FakeModule], useFactory: () => ({}) }).getImports()).toEqual([FakeModule]);
    expect(new CountersPlugin().getImports()).toEqual([]);
  });

  it('should resolve the named client and fail helpfully when missing', async () => {
    const plugin = new CountersPlugin({ client: 'stats' });
    const provider = findProvider(plugin, COUNTERS_REDIS_DRIVER) as FactoryProvider;

    const driver = { id: 'driver' };
    const manager = { getClient: vi.fn().mockResolvedValue(driver) };
    expect(await provider.useFactory(manager, undefined, { client: 'stats' })).toBe(driver);

    const broken = { getClient: vi.fn().mockRejectedValue(new Error('nope')) };
    await expect(provider.useFactory(broken, undefined, { client: 'stats' })).rejects.toThrow(/Redis client "stats" not found/);
  });
});
