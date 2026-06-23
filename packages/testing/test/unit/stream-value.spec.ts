import { describe, it, expect } from 'vitest';

import { StreamValue, compareIds } from '../../src/memory/domain/store/stream-value';
import { MemoryDriverError } from '../../src/shared/errors';

/**
 * Unit tests for the pure StreamValue domain model (id ordering, groups, PEL).
 */
describe('compareIds', () => {
  it('orders by millisecond then sequence', () => {
    expect(compareIds('1-0', '2-0')).toBeLessThan(0);
    expect(compareIds('2-0', '1-0')).toBeGreaterThan(0);
    expect(compareIds('1-1', '1-2')).toBeLessThan(0);
    expect(compareIds('5-3', '5-3')).toBe(0);
  });
});

describe('StreamValue', () => {
  it('generates auto ids that increment the sequence within the same millisecond', () => {
    const s = new StreamValue();
    const id1 = s.add('*', ['a', '1'], 1000);
    const id2 = s.add('*', ['a', '2'], 1000); // same ms
    expect(id1).toBe('1000-0');
    expect(id2).toBe('1000-1');
    const id3 = s.add('*', ['a', '3'], 2000); // later ms
    expect(id3).toBe('2000-0');
  });

  it('supports the ms-* auto-sequence form', () => {
    const s = new StreamValue();
    expect(s.add('5-*', ['a', '1'], 0)).toBe('5-0');
    expect(s.add('5-*', ['a', '2'], 0)).toBe('5-1');
  });

  it('rejects ids that are not strictly increasing', () => {
    const s = new StreamValue();
    s.add('10-0', ['a', '1'], 0);
    expect(() => s.add('10-0', ['a', '2'], 0)).toThrow(MemoryDriverError);
    expect(() => s.add('9-0', ['a', '2'], 0)).toThrow(MemoryDriverError);
  });

  it('readAfter resolves $ to the current last id', () => {
    const s = new StreamValue();
    s.add('1-0', ['f', '1'], 0);
    s.add('2-0', ['f', '2'], 0);
    expect(s.readAfter('$')).toEqual([]);
    expect(s.readAfter('1-0').map((e) => e.id)).toEqual(['2-0']);
  });

  it('throws NOGROUP for operations on a missing group', () => {
    const s = new StreamValue();
    expect(() => s.ack('ghost', ['1-0'])).toThrow(/NOGROUP/);
    expect(() => s.pendingSummary('ghost')).toThrow(/NOGROUP/);
    expect(() => s.setGroupId('ghost', '0')).toThrow(/NOGROUP/);
  });

  it('createGroup with $ starts after the last id; 0 starts from the beginning', () => {
    const s = new StreamValue();
    s.add('1-0', ['f', '1'], 0);
    s.createGroup('late', '$');
    s.createGroup('early', '0');
    s.add('2-0', ['f', '2'], 0);

    // 'late' only sees messages added after the group was created
    expect(s.readGroup('late', 'c', '>', 100, undefined, false).map((e) => e.id)).toEqual(['2-0']);
    // 'early' sees everything
    expect(s.readGroup('early', 'c', '>', 100, undefined, false).map((e) => e.id)).toEqual(['1-0', '2-0']);
  });

  it('delConsumer removes that consumer and its pending entries', () => {
    const s = new StreamValue();
    s.add('1-0', ['f', '1'], 0);
    s.createGroup('g', '0');
    s.readGroup('g', 'c1', '>', 100, undefined, false);
    expect(s.delConsumer('g', 'c1')).toBe(1);
    expect(s.pendingSummary('g').count).toBe(0);
  });

  it('setGroupId redirects future delivery', () => {
    const s = new StreamValue();
    s.add('1-0', ['f', '1'], 0);
    s.add('2-0', ['f', '2'], 0);
    s.createGroup('g', '$'); // would see nothing new
    s.setGroupId('g', '0'); // rewind to start
    expect(s.readGroup('g', 'c', '>', 100, undefined, false).map((e) => e.id)).toEqual(['1-0', '2-0']);
  });

  it('claim drops pending ids whose entry was deleted', () => {
    const s = new StreamValue();
    s.add('1-0', ['f', '1'], 0);
    s.createGroup('g', '0');
    s.readGroup('g', 'c1', '>', 100, undefined, false);
    s.del(['1-0']); // entry gone, but still in PEL
    expect(s.claim('g', 'c2', 0, ['1-0'], 100)).toEqual([]);
    expect(s.pendingSummary('g').count).toBe(0); // dropped from PEL
  });
});
