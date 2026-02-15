import { describe, it, expect, beforeEach } from 'vitest';
import { LruStrategy } from '../../src/strategies/lru.strategy';

describe('LruStrategy', () => {
  let strategy: LruStrategy<string>;

  beforeEach(() => {
    strategy = new LruStrategy<string>();
  });

  describe('recordInsert', () => {
    it('should add key with timestamp', () => {
      // Given/When
      strategy.recordInsert('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key1']);
    });

    it('should add multiple keys in order', () => {
      // Given/When
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // Then
      expect(strategy.size()).toBe(3);
      expect(strategy.getKeys()).toEqual(['key1', 'key2', 'key3']);
    });

    it('should update timestamp on re-insert', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When - re-insert key1
      strategy.recordInsert('key1');

      // Then - key1 should now be newest
      expect(strategy.getKeys()).toEqual(['key2', 'key1']);
    });

    it('should handle numeric keys', () => {
      // Given
      const numStrategy = new LruStrategy<number>();

      // When
      numStrategy.recordInsert(1);
      numStrategy.recordInsert(2);
      numStrategy.recordInsert(3);

      // Then
      expect(numStrategy.size()).toBe(3);
      expect(numStrategy.getKeys()).toEqual([1, 2, 3]);
    });
  });

  describe('recordAccess', () => {
    it('should update key to most recent', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordAccess('key1');

      // Then - key1 should be most recent
      expect(strategy.getKeys()).toEqual(['key2', 'key3', 'key1']);
      expect(strategy.selectVictim()).toBe('key2');
    });

    it('should handle accessing middle key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordAccess('key2');

      // Then
      expect(strategy.getKeys()).toEqual(['key1', 'key3', 'key2']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should handle accessing newest key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordAccess('key2');

      // Then
      expect(strategy.getKeys()).toEqual(['key1', 'key2']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should handle multiple accesses to same key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');

      // Then - key1 should still be most recent
      expect(strategy.getKeys()).toEqual(['key2', 'key3', 'key1']);
    });

    it('should create new entry if key not present', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordAccess('key2');

      // Then
      expect(strategy.size()).toBe(2);
      expect(strategy.getKeys()).toEqual(['key1', 'key2']);
    });
  });

  describe('recordDelete', () => {
    it('should remove key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key2']);
    });

    it('should handle deleting middle key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordDelete('key2');

      // Then
      expect(strategy.size()).toBe(2);
      expect(strategy.getKeys()).toEqual(['key1', 'key3']);
    });

    it('should handle deleting non-existent key', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordDelete('key2');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key1']);
    });

    it('should handle deleting all keys', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');
      strategy.recordDelete('key2');

      // Then
      expect(strategy.size()).toBe(0);
      expect(strategy.getKeys()).toEqual([]);
    });
  });

  describe('selectVictim', () => {
    it('should return least recently used key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key1'); // Make key1 more recent

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key2');
    });

    it('should return oldest when no accesses', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key1');
    });

    it('should return undefined for empty strategy', () => {
      // Given/When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBeUndefined();
    });

    it('should return only key when single item', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key1');
    });

    it('should not remove victim from tracking', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key1');
      expect(strategy.size()).toBe(2);
    });
  });

  describe('getVictims', () => {
    it('should return least recently used keys', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordInsert('key4');
      strategy.recordInsert('key5');
      strategy.recordAccess('key1'); // Make key1 most recent

      // When
      const victims = strategy.getVictims(3);

      // Then
      expect(victims).toEqual(['key2', 'key3']);
    });

    it('should return empty array when at target size', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const victims = strategy.getVictims(2);

      // Then
      expect(victims).toEqual([]);
    });

    it('should return empty array when below target size', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const victims = strategy.getVictims(5);

      // Then
      expect(victims).toEqual([]);
    });

    it('should return all keys when target is zero', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key2');

      // When
      const victims = strategy.getVictims(0);

      // Then - should be in LRU order
      expect(victims).toEqual(['key1', 'key3', 'key2']);
    });

    it('should handle target size of 1', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const victims = strategy.getVictims(1);

      // Then
      expect(victims).toEqual(['key1', 'key2']);
    });
  });

  describe('clear', () => {
    it('should remove all keys', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.clear();

      // Then
      expect(strategy.size()).toBe(0);
      expect(strategy.getKeys()).toEqual([]);
      expect(strategy.selectVictim()).toBeUndefined();
    });

    it('should reset timestamp counter', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordAccess('key1');
      strategy.clear();

      // When
      strategy.recordInsert('key2');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key2']);
    });

    it('should allow adding keys after clear', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.clear();

      // When
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // Then
      expect(strategy.size()).toBe(2);
      expect(strategy.getKeys()).toEqual(['key2', 'key3']);
    });
  });

  describe('size', () => {
    it('should return zero for empty strategy', () => {
      // Given/When
      const size = strategy.size();

      // Then
      expect(size).toBe(0);
    });

    it('should return correct size after inserts', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const size = strategy.size();

      // Then
      expect(size).toBe(3);
    });

    it('should not change on access', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordAccess('key1');

      // When
      const size = strategy.size();

      // Then
      expect(size).toBe(2);
    });

    it('should update after delete', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordDelete('key1');

      // When
      const size = strategy.size();

      // Then
      expect(size).toBe(1);
    });
  });

  describe('getKeys', () => {
    it('should return empty array for empty strategy', () => {
      // Given/When
      const keys = strategy.getKeys();

      // Then
      expect(keys).toEqual([]);
    });

    it('should return keys in LRU order', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const keys = strategy.getKeys();

      // Then - oldest to newest
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should reflect access order', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key1');

      // When
      const keys = strategy.getKeys();

      // Then - key1 should be newest
      expect(keys).toEqual(['key2', 'key3', 'key1']);
    });

    it('should return copy of keys array', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const keys = strategy.getKeys();
      keys.push('key2');

      // Then
      expect(strategy.getKeys()).toEqual(['key1']);
      expect(strategy.size()).toBe(1);
    });
  });

  describe('LRU behavior scenarios', () => {
    it('should evict least recently used when full', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key2');
      strategy.recordAccess('key3');

      // When
      const victim = strategy.selectVictim();

      // Then - key1 is least recently used
      expect(victim).toBe('key1');
    });

    it('should handle complex access pattern', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordInsert('key4');

      // When - create specific access pattern
      strategy.recordAccess('key2'); // key2 accessed
      strategy.recordAccess('key4'); // key4 accessed
      strategy.recordAccess('key2'); // key2 accessed again

      // Then - order should be: key1 (oldest), key3, key4, key2 (newest)
      expect(strategy.getKeys()).toEqual(['key1', 'key3', 'key4', 'key2']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should protect recently accessed keys from eviction', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordAccess('key1'); // Protect key1

      // When
      const victims = strategy.getVictims(2);

      // Then - key2 should be evicted before key1
      expect(victims).toEqual(['key2']);
    });

    it('should handle insert-access-insert sequence', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordAccess('key1');

      // When
      strategy.recordInsert('key2');

      // Then - key2 is more recent than key1 (higher timestamp)
      expect(strategy.getKeys()).toEqual(['key1', 'key2']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should maintain correct order with interleaved operations', () => {
      // Given/When
      strategy.recordInsert('key1'); // ts=1
      strategy.recordInsert('key2'); // ts=2
      strategy.recordAccess('key1'); // ts=3
      strategy.recordInsert('key3'); // ts=4
      strategy.recordAccess('key2'); // ts=5
      strategy.recordInsert('key4'); // ts=6

      // Then - order by timestamp: key1(3), key3(4), key2(5), key4(6)
      expect(strategy.getKeys()).toEqual(['key1', 'key3', 'key2', 'key4']);
      expect(strategy.selectVictim()).toBe('key1');
    });
  });
});
