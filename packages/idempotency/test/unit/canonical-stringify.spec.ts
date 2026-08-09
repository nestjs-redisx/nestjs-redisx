import { describe, it, expect } from 'vitest';
import { canonicalStringify } from '../../src/shared/utils/canonical-stringify';

describe('canonicalStringify', () => {
  it('should produce the same output regardless of top-level key order', () => {
    // Given
    const a = { amount: 100, currency: 'USD' };
    const b = { currency: 'USD', amount: 100 };

    // When / Then
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('should sort keys RECURSIVELY (nested objects too)', () => {
    // Given — same data, different nesting order
    const a = { user: { name: 'Ann', id: 1 }, items: [{ qty: 2, sku: 'x' }] };
    const b = { items: [{ sku: 'x', qty: 2 }], user: { id: 1, name: 'Ann' } };

    // When / Then
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('should preserve array ORDER (order is significant)', () => {
    // Given
    const a = { ids: [1, 2, 3] };
    const b = { ids: [3, 2, 1] };

    // When / Then
    expect(canonicalStringify(a)).not.toBe(canonicalStringify(b));
  });

  it('should distinguish genuinely different bodies', () => {
    expect(canonicalStringify({ amount: 100 })).not.toBe(canonicalStringify({ amount: 200 }));
  });

  it('should match JSON.stringify for already-sorted plain data (legacy parity)', () => {
    // Given — keys already in sorted order: canonical output must equal plain
    // JSON.stringify so pre-upgrade fingerprints of ordered bodies still match
    const value = { a: 1, b: 'x', c: [1, { d: true }] };

    // When / Then
    expect(canonicalStringify(value)).toBe(JSON.stringify(value));
  });

  it('should handle primitives, null, and undefined', () => {
    expect(canonicalStringify('s')).toBe('"s"');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBe('null');
  });

  it('should not throw on BigInt (JSON.stringify does)', () => {
    expect(() => canonicalStringify({ big: 1n })).not.toThrow();
    expect(canonicalStringify({ big: 1n })).toBe('{"big":1}');
  });

  it('should serialize Date like JSON.stringify', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(canonicalStringify({ at: date })).toBe(JSON.stringify({ at: date }));
  });

  it('should skip undefined/function/symbol object values like JSON.stringify', () => {
    // Given
    const value = { keep: 1, drop: undefined, fn: () => 1, sym: Symbol('x') };

    // When / Then
    expect(canonicalStringify(value)).toBe('{"keep":1}');
  });

  it('should serialize undefined/function array items as null like JSON.stringify', () => {
    expect(canonicalStringify([1, undefined, () => 1])).toBe('[1,null,null]');
  });

  it('should serialize Maps deterministically and type-distinct (parity with cache stableStringify)', () => {
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
    expect(canonicalStringify(m1)).toBe('Map{"a":1,"b":2}');
    expect(canonicalStringify(m1)).toBe(canonicalStringify(m2));
    expect(canonicalStringify(m1)).not.toBe(canonicalStringify({ a: 1, b: 2 }));
  });

  it('should serialize Sets order-insensitively and distinct from arrays', () => {
    expect(canonicalStringify(new Set([2, 1, 3]))).toBe('Set[1,2,3]');
    expect(canonicalStringify(new Set([1, 2]))).not.toBe(canonicalStringify([1, 2]));
  });
});
