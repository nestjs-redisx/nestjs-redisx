import { describe, it, expect } from 'vitest';
import { hashKey, stableStringify } from '../../src/shared/utils/stable-hash';

describe('stableStringify', () => {
  it('should sort object keys recursively (order-insensitive at every level)', () => {
    // Given
    const a = { user: { name: 'Ann', id: 1 }, tags: ['x', 'y'] };
    const b = { tags: ['x', 'y'], user: { id: 1, name: 'Ann' } };

    // When / Then
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('should preserve array order (order is significant)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('should match JSON.stringify for already-sorted plain data', () => {
    const value = { a: 1, b: 'x', c: [1, { d: true }] };
    expect(stableStringify(value)).toBe(JSON.stringify(value));
  });

  it('should handle primitives, null, undefined, BigInt, and Date', () => {
    expect(stableStringify('s')).toBe('"s"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(() => stableStringify({ big: 1n })).not.toThrow();
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(stableStringify({ at: date })).toBe(JSON.stringify({ at: date }));
  });

  it('should skip undefined/function/symbol object values like JSON.stringify', () => {
    expect(stableStringify({ keep: 1, drop: undefined, fn: () => 1 })).toBe('{"keep":1}');
  });
});

describe('hashKey', () => {
  it('should be key-order-insensitive and data-sensitive', () => {
    // Given / When / Then
    expect(hashKey({ a: 1, b: 2 })).toBe(hashKey({ b: 2, a: 1 }));
    expect(hashKey({ m: { a: 1, b: 2 } })).toBe(hashKey({ m: { b: 2, a: 1 } }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });

  it('should produce a 16-char lowercase hex string (CacheKey-safe)', () => {
    expect(hashKey({ any: 'value' })).toMatch(/^[a-f0-9]{16}$/);
  });

  describe('FROZEN ALGORITHM (golden vectors)', () => {
    // These exact outputs are a public contract: user cache keys are derived
    // from them. If one of these assertions fails, the algorithm changed —
    // which silently invalidates every derived key on upgrade. Do NOT update
    // the expected values; ship a changed algorithm under a NEW name instead.
    it.each([
      [{ b: 2, a: 1 }, '43258cff783fe703'],
      [{ z: [1, 2], m: { b: 2, a: 1 } }, 'caca2714be25bd3c'],
      ['hello', '5aa762ae383fbb72'],
    ])('hashKey(%j) === %s', (input, expected) => {
      expect(hashKey(input)).toBe(expected);
    });
  });

  describe('Map and Set support', () => {
    it('distinct Maps no longer collide (previously ALL Maps serialized to {})', () => {
      // Given / When / Then
      expect(hashKey(new Map([['a', 1]]))).not.toBe(hashKey(new Map([['b', 999]])));
      expect(hashKey(new Map([['a', 1]]))).not.toBe(hashKey({}));
      expect(hashKey(new Set(['x']))).not.toBe(hashKey({}));
    });

    it('Map is type-distinct from an equivalent plain object', () => {
      expect(hashKey(new Map([['a', 1]]))).not.toBe(hashKey({ a: 1 }));
    });

    it('Map is insertion-order-insensitive', () => {
      // Given
      const m1 = new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]);
      const m2 = new Map<string, number>([
        ['b', 2],
        ['a', 1],
      ]);

      // When / Then
      expect(hashKey(m1)).toBe(hashKey(m2));
    });

    it('Set is order-insensitive and distinct from an array', () => {
      expect(hashKey(new Set([1, 2, 3]))).toBe(hashKey(new Set([3, 2, 1])));
      expect(hashKey(new Set([1, 2]))).not.toBe(hashKey([1, 2]));
    });

    it('nested Map/Set inside objects are canonicalized too', () => {
      // Given
      const a = { tags: new Set(['b', 'a']), meta: new Map([['k', 1]]) };
      const b = { meta: new Map([['k', 1]]), tags: new Set(['a', 'b']) };

      // When / Then
      expect(hashKey(a)).toBe(hashKey(b));
    });

    describe('FROZEN ALGORITHM (golden vectors for Map/Set)', () => {
      // Same contract as above: do NOT update these values - a changed
      // algorithm ships under a new name.
      it.each([
        [new Map([['a', 1]]), '3a92e341c499c7ab'],
        [new Set([1, 2, 3]), '25cef1d27a85c7be'],
      ])('hashKey(%o) === %s', (input, expected) => {
        expect(hashKey(input)).toBe(expected);
      });
    });
  });
});
