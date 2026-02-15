import { describe, it, expect, beforeEach } from 'vitest';
import { LfuStrategy } from '../../src/strategies/lfu.strategy';

describe('LfuStrategy', () => {
  let strategy: LfuStrategy<string>;

  beforeEach(() => {
    strategy = new LfuStrategy<string>();
  });

  describe('recordInsert', () => {
    it('should track inserted key with frequency 1', () => {
      // Given/When
      strategy.recordInsert('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.has('key1')).toBe(true);
      expect(strategy.getFrequency('key1')).toBe(1);
    });

    it('should not duplicate key on repeated insert', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordInsert('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getFrequency('key1')).toBe(1);
    });

    it('should track multiple keys', () => {
      // Given/When
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // Then
      expect(strategy.size()).toBe(3);
    });
  });

  describe('recordAccess', () => {
    it('should increment frequency on access', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordAccess('key1');

      // Then
      expect(strategy.getFrequency('key1')).toBe(2);
    });

    it('should increment frequency multiple times', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');

      // Then
      expect(strategy.getFrequency('key1')).toBe(4);
    });

    it('should not affect non-existent key', () => {
      // Given/When
      strategy.recordAccess('nonexistent');

      // Then
      expect(strategy.size()).toBe(0);
      expect(strategy.getFrequency('nonexistent')).toBe(0);
    });
  });

  describe('recordDelete', () => {
    it('should remove key from tracking', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.has('key1')).toBe(false);
      expect(strategy.has('key2')).toBe(true);
    });

    it('should handle delete of non-existent key', () => {
      // Given/When
      strategy.recordDelete('nonexistent');

      // Then
      expect(strategy.size()).toBe(0);
    });
  });

  describe('selectVictim', () => {
    it('should return undefined when empty', () => {
      // Given/When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBeUndefined();
    });

    it('should return the only key when single entry', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key1');
    });

    it('should return least frequently used key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key1'); // freq: 2
      strategy.recordAccess('key1'); // freq: 3
      strategy.recordAccess('key3'); // freq: 2

      // When — key2 has freq 1 (lowest)
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key2');
    });

    it('should use insertion order as tiebreaker when frequencies equal', () => {
      // Given
      strategy.recordInsert('key1'); // insertOrder: 1
      strategy.recordInsert('key2'); // insertOrder: 2
      strategy.recordInsert('key3'); // insertOrder: 3
      // All have frequency 1

      // When
      const victim = strategy.selectVictim();

      // Then — key1 is oldest
      expect(victim).toBe('key1');
    });

    it('should select correct victim after mixed access patterns', () => {
      // Given
      strategy.recordInsert('a');
      strategy.recordInsert('b');
      strategy.recordInsert('c');
      strategy.recordAccess('a'); // freq: 2
      strategy.recordAccess('b'); // freq: 2
      strategy.recordAccess('a'); // freq: 3

      // When — c has freq 1 (lowest)
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('c');
    });

    it('should update victim after frequency changes', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      // Both freq: 1, key1 is oldest → victim is key1

      // When — boost key1 frequency
      strategy.recordAccess('key1'); // freq: 2

      // Then — key2 is now least frequent
      expect(strategy.selectVictim()).toBe('key2');
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.clear();

      // Then
      expect(strategy.size()).toBe(0);
      expect(strategy.selectVictim()).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return 0 when empty', () => {
      expect(strategy.size()).toBe(0);
    });

    it('should return correct count', () => {
      // Given/When
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // Then
      expect(strategy.size()).toBe(3);
    });

    it('should decrease after delete', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');

      // Then
      expect(strategy.size()).toBe(1);
    });
  });

  describe('getKeys', () => {
    it('should return empty array when empty', () => {
      expect(strategy.getKeys()).toEqual([]);
    });

    it('should return keys sorted by frequency ascending', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key3'); // freq: 2
      strategy.recordAccess('key3'); // freq: 3
      strategy.recordAccess('key1'); // freq: 2

      // When
      const keys = strategy.getKeys();

      // Then — key2(1) < key1(2) < key3(3)
      expect(keys).toEqual(['key2', 'key1', 'key3']);
    });

    it('should use insertion order for same frequency', () => {
      // Given
      strategy.recordInsert('c');
      strategy.recordInsert('a');
      strategy.recordInsert('b');
      // All freq: 1

      // When
      const keys = strategy.getKeys();

      // Then — sorted by insertOrder: c(1), a(2), b(3)
      expect(keys).toEqual(['c', 'a', 'b']);
    });
  });

  describe('getVictims', () => {
    it('should return empty when at or below target size', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const victims = strategy.getVictims(2);

      // Then
      expect(victims).toEqual([]);
    });

    it('should return empty when target exceeds current size', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const victims = strategy.getVictims(5);

      // Then
      expect(victims).toEqual([]);
    });

    it('should return correct number of victims', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key2'); // freq: 2
      strategy.recordAccess('key2'); // freq: 3

      // When — need to evict 1 to reach target 2
      const victims = strategy.getVictims(2);

      // Then — key1 and key3 have freq 1, key1 inserted first
      expect(victims).toEqual(['key1']);
    });

    it('should return multiple victims when needed', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordInsert('key4');
      strategy.recordAccess('key4'); // freq: 2
      strategy.recordAccess('key4'); // freq: 3
      strategy.recordAccess('key4'); // freq: 4

      // When — evict 3 to reach target 1
      const victims = strategy.getVictims(1);

      // Then — key1(1), key2(1), key3(1) are victims, key4(4) survives
      expect(victims).toHaveLength(3);
      expect(victims).toEqual(['key1', 'key2', 'key3']);
    });

    it('should evict to target size 0', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const victims = strategy.getVictims(0);

      // Then
      expect(victims).toHaveLength(2);
    });
  });

  describe('has', () => {
    it('should return false for non-existent key', () => {
      expect(strategy.has('nonexistent')).toBe(false);
    });

    it('should return true for existing key', () => {
      // Given
      strategy.recordInsert('key1');

      // Then
      expect(strategy.has('key1')).toBe(true);
    });

    it('should return false after delete', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordDelete('key1');

      // Then
      expect(strategy.has('key1')).toBe(false);
    });
  });

  describe('getFrequency', () => {
    it('should return 0 for non-existent key', () => {
      expect(strategy.getFrequency('nonexistent')).toBe(0);
    });

    it('should return 1 after insert', () => {
      // Given
      strategy.recordInsert('key1');

      // Then
      expect(strategy.getFrequency('key1')).toBe(1);
    });

    it('should track frequency accurately', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');

      // Then
      expect(strategy.getFrequency('key1')).toBe(4);
    });
  });

  describe('LFU behavior scenarios', () => {
    it('should prefer evicting least frequent over oldest', () => {
      // Given — key1 is oldest but accessed more
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordAccess('key1'); // key1 freq: 2
      strategy.recordAccess('key1'); // key1 freq: 3

      // When
      const victim = strategy.selectVictim();

      // Then — key2 has lower frequency despite being newer
      expect(victim).toBe('key2');
    });

    it('should handle insert-delete-insert correctly', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordAccess('key1'); // freq: 2
      strategy.recordDelete('key1');

      // When — re-insert resets frequency
      strategy.recordInsert('key1');

      // Then
      expect(strategy.getFrequency('key1')).toBe(1);
    });

    it('should handle complex access patterns', () => {
      // Given
      strategy.recordInsert('hot');
      strategy.recordInsert('warm');
      strategy.recordInsert('cold');

      // Hot key accessed many times
      for (let i = 0; i < 10; i++) {
        strategy.recordAccess('hot');
      }
      // Warm key accessed a few times
      for (let i = 0; i < 3; i++) {
        strategy.recordAccess('warm');
      }

      // When
      const victims = strategy.getVictims(1);

      // Then — cold(1), warm(4), hot(11)
      expect(victims).toEqual(['cold', 'warm']);
    });

    it('should work correctly with single element', () => {
      // Given
      strategy.recordInsert('only');

      // When
      const victims = strategy.getVictims(0);

      // Then
      expect(victims).toEqual(['only']);
    });
  });
});
