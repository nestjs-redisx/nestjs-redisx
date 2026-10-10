import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisCounterStoreAdapter } from '../../src/counter/infrastructure/adapters/redis-counter-store.adapter';
import { INCRBY_WITH_WINDOW_SCRIPT, GET_AND_RESET_SCRIPT, SET_KEEP_TTL_SCRIPT } from '../../src/counter/infrastructure/scripts/lua-scripts';
import { CounterValueError } from '../../src/shared/errors';

interface MockDriver {
  scriptLoad: ReturnType<typeof vi.fn>;
  evalsha: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  incrby: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function createMockDriver(): MockDriver {
  return {
    scriptLoad: vi.fn().mockImplementation(async (script: string) => `sha:${script.length}`),
    evalsha: vi.fn().mockResolvedValue('1'),
    eval: vi.fn().mockResolvedValue('1'),
    incrby: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('RedisCounterStoreAdapter', () => {
  let driver: MockDriver;
  let adapter: RedisCounterStoreAdapter;

  beforeEach(() => {
    driver = createMockDriver();
    adapter = new RedisCounterStoreAdapter(driver as never);
  });

  describe('onModuleInit', () => {
    it('should pre-load both scripts and survive a pre-load failure', async () => {
      await adapter.onModuleInit();
      expect(driver.scriptLoad).toHaveBeenCalledWith(INCRBY_WITH_WINDOW_SCRIPT);
      expect(driver.scriptLoad).toHaveBeenCalledWith(GET_AND_RESET_SCRIPT);

      driver.scriptLoad.mockRejectedValue(new Error('LOADING'));
      await expect(adapter.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('incrementBy', () => {
    it('should use plain INCRBY without a TTL', async () => {
      driver.incrby.mockResolvedValue(7);
      expect(await adapter.incrementBy('_ctr:k', 3)).toBe(7);
      expect(driver.incrby).toHaveBeenCalledWith('_ctr:k', 3);
      expect(driver.evalsha).not.toHaveBeenCalled();
    });

    it('should use the window script when a TTL is given', async () => {
      driver.evalsha.mockResolvedValue(4);
      expect(await adapter.incrementBy('_ctr:k', 1, 60_000)).toBe(4);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_ctr:k'], [1, 60_000]);
    });

    it('should fall back to EVAL on NOSCRIPT (message or cause)', async () => {
      const wrapped = new Error('Command EVALSHA failed');
      (wrapped as { cause?: Error }).cause = new Error('NOSCRIPT No matching script');
      driver.evalsha.mockRejectedValueOnce(wrapped);
      driver.eval.mockResolvedValue(9);

      expect(await adapter.incrementBy('_ctr:k', 1, 1_000)).toBe(9);
      expect(driver.eval).toHaveBeenCalledWith(INCRBY_WITH_WINDOW_SCRIPT, ['_ctr:k'], [1, 1_000]);
    });

    it('should rethrow non-NOSCRIPT errors untouched', async () => {
      driver.evalsha.mockRejectedValue(new Error('READONLY'));
      await expect(adapter.incrementBy('_ctr:k', 1, 1_000)).rejects.toThrow('READONLY');
      expect(driver.eval).not.toHaveBeenCalled();
    });
  });

  describe('adversarial: non-canonical numeric values', () => {
    it('should throw CounterValueError (carrying the ACTUAL raw value) for empty/whitespace/float/garbage strings', async () => {
      // Number('') === 0 and Number(' ') === 0 - a poisoned key must NOT
      // read as a legitimate zero, and the error must carry the evidence.
      for (const raw of ['', '  ', '3.14', '1e3', 'abc']) {
        driver.get.mockResolvedValue(raw);
        await expect(adapter.get('_ctr:k'), `raw=${JSON.stringify(raw)}`).rejects.toMatchObject({ rawValue: raw });
      }
      // Canonical integers (negative included) still parse
      driver.get.mockResolvedValue('-42');
      expect(await adapter.get('_ctr:k')).toBe(-42);
    });

    it('should reject integers past 2^53 instead of silently losing precision (duplicate sequence ids)', async () => {
      driver.get.mockResolvedValue('9007199254740993'); // MAX_SAFE_INTEGER + 2
      await expect(adapter.get('_ctr:k')).rejects.toThrow(CounterValueError);
    });

    it('should apply the same strict throwing parse to getAndReset', async () => {
      driver.evalsha.mockResolvedValue('');
      await expect(adapter.getAndReset('_ctr:k')).rejects.toMatchObject({ rawValue: '' });
      driver.evalsha.mockResolvedValue('7');
      expect(await adapter.getAndReset('_ctr:k')).toBe(7);
    });

    it('getAndReset Lua must preserve clearly-non-numeric evidence (no del before the check)', () => {
      // The script deletes only after tonumber() accepts the value.
      expect(GET_AND_RESET_SCRIPT.indexOf('tonumber')).toBeLessThan(GET_AND_RESET_SCRIPT.indexOf('del'));
    });
  });

  describe('get / set / reset / getAndReset', () => {
    it('should parse get results and keep null for missing keys', async () => {
      expect(await adapter.get('_ctr:k')).toBeNull();
      driver.get.mockResolvedValue('42');
      expect(await adapter.get('_ctr:k')).toBe(42);
    });

    it('should set preserving an existing TTL (Lua) and with an explicit PX', async () => {
      // Without ttl: through the keep-ttl script - a plain SET would drop a
      // window counter's TTL and make the key permanent forever
      await adapter.set('_ctr:k', 5);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_ctr:k'], [5]);

      await adapter.set('_ctr:k', 5, 2_000);
      expect(driver.set).toHaveBeenCalledWith('_ctr:k', '5', { px: 2_000 });
    });

    it('should report reset existence', async () => {
      expect(await adapter.reset('_ctr:k')).toBe(true);
      driver.del.mockResolvedValue(0);
      expect(await adapter.reset('_ctr:k')).toBe(false);
    });

    it('should getAndReset via the script and default null to 0', async () => {
      driver.evalsha.mockResolvedValue('17');
      expect(await adapter.getAndReset('_ctr:k')).toBe(17);
      driver.evalsha.mockResolvedValue(null);
      expect(await adapter.getAndReset('_ctr:k')).toBe(0);
    });
  });
});
