import { describe, it, expect, beforeEach } from 'vitest';

import { MemoryStore } from '../../src/memory/domain/store/memory-store';
import { WrongTypeError } from '../../src/shared/errors';

/**
 * Unit tests for the in-memory keyspace: typed access, lazy TTL expiry, helpers.
 */
describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('typed access', () => {
    it('read returns undefined for a missing key', () => {
      expect(store.read('missing', 'string')).toBeUndefined();
    });

    it('read throws WrongTypeError on a type mismatch', () => {
      store.writeString('k', 'v');
      expect(() => store.read('k', 'hash')).toThrow(WrongTypeError);
    });

    it('readOrCreate creates an empty container of each kind', () => {
      expect(store.readOrCreate('h', 'hash')).toBeInstanceOf(Map);
      expect(store.readOrCreate('s', 'set')).toBeInstanceOf(Set);
      expect(store.readOrCreate('z', 'zset')).toBeInstanceOf(Map);
      expect(store.readOrCreate('l', 'list')).toEqual([]);
    });

    it('readOrCreate returns the existing container on a second call', () => {
      const first = store.readOrCreate('h', 'hash');
      first.set('a', '1');
      const second = store.readOrCreate('h', 'hash');
      expect(second.get('a')).toBe('1');
      expect(second).toBe(first);
    });
  });

  describe('lifecycle helpers', () => {
    it('has / delete / type / flush', () => {
      store.writeString('k', 'v');
      expect(store.has('k')).toBe(true);
      expect(store.type('k')).toBe('string');
      expect(store.delete('k')).toBe(true);
      expect(store.delete('k')).toBe(false);
      expect(store.type('k')).toBe('none');

      store.writeString('a', '1');
      store.flush();
      expect(store.has('a')).toBe(false);
    });

    it('keys lists only live keys', () => {
      store.writeString('a', '1');
      store.writeString('b', '2');
      expect(store.keys().sort()).toEqual(['a', 'b']);
    });
  });

  describe('expiry', () => {
    it('setExpireAt returns false for a missing key', () => {
      expect(store.setExpireAt('missing', store.now() + 1000)).toBe(false);
    });

    it('pttl reports -2 (missing), -1 (no expiry), and remaining ms', () => {
      expect(store.pttl('missing')).toBe(-2);
      store.writeString('k', 'v');
      expect(store.pttl('k')).toBe(-1);
      store.setExpireAt('k', store.now() + 5000);
      expect(store.pttl('k')).toBeGreaterThan(0);
    });

    it('lazily evicts expired keys', () => {
      store.writeString('k', 'v');
      // Force expiry in the past via a frozen clock.
      store.now = () => 1_000_000;
      store.setExpireAt('k', 999_999);
      expect(store.has('k')).toBe(false);
      expect(store.read('k', 'string')).toBeUndefined();
      expect(store.pttl('k')).toBe(-2);
    });

    it('writeString clears a previous TTL', () => {
      store.writeString('k', 'v');
      store.setExpireAt('k', store.now() + 5000);
      store.writeString('k', 'fresh');
      expect(store.pttl('k')).toBe(-1);
    });
  });
});
