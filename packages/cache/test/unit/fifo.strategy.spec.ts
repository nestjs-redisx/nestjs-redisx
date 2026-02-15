import { describe, it, expect, beforeEach } from 'vitest';
import { FifoStrategy } from '../../src/strategies/fifo.strategy';

describe('FifoStrategy', () => {
  let strategy: FifoStrategy<string>;

  beforeEach(() => {
    strategy = new FifoStrategy<string>();
  });

  describe('recordInsert', () => {
    it('should add key to queue', () => {
      // Given/When
      strategy.recordInsert('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.has('key1')).toBe(true);
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

    it('should not add duplicate key', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      strategy.recordInsert('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key1']);
    });

    it('should handle numeric keys', () => {
      // Given
      const numStrategy = new FifoStrategy<number>();

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
    it('should be no-op in FIFO', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordAccess('key1');

      // Then - order should remain unchanged
      expect(strategy.getKeys()).toEqual(['key1', 'key2', 'key3']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should not affect eviction order', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When - access key1 multiple times
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');
      strategy.recordAccess('key1');

      // Then - key1 should still be first to evict
      expect(strategy.selectVictim()).toBe('key1');
    });
  });

  describe('recordDelete', () => {
    it('should remove key from queue', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.has('key1')).toBe(false);
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

    it('should handle deleting last key', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordDelete('key3');

      // Then
      expect(strategy.size()).toBe(2);
      expect(strategy.getKeys()).toEqual(['key1', 'key2']);
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

    it('should remove all keys when deleted one by one', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      strategy.recordDelete('key1');
      strategy.recordDelete('key2');
      strategy.recordDelete('key3');

      // Then
      expect(strategy.size()).toBe(0);
      expect(strategy.getKeys()).toEqual([]);
    });
  });

  describe('selectVictim', () => {
    it('should return oldest key', () => {
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

    it('should not remove victim from queue', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const victim = strategy.selectVictim();

      // Then
      expect(victim).toBe('key1');
      expect(strategy.size()).toBe(2);
      expect(strategy.has('key1')).toBe(true);
    });
  });

  describe('getVictims', () => {
    it('should return oldest keys up to target size', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');
      strategy.recordInsert('key4');
      strategy.recordInsert('key5');

      // When
      const victims = strategy.getVictims(3);

      // Then
      expect(victims).toEqual(['key1', 'key2']);
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

    it('should return all keys when target size is zero', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const victims = strategy.getVictims(0);

      // Then
      expect(victims).toEqual(['key1', 'key2', 'key3']);
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

    it('should allow adding keys after clear', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.clear();

      // When
      strategy.recordInsert('key2');

      // Then
      expect(strategy.size()).toBe(1);
      expect(strategy.getKeys()).toEqual(['key2']);
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

    it('should update size after delete', () => {
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

  describe('has', () => {
    it('should return true for existing key', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const exists = strategy.has('key1');

      // Then
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', () => {
      // Given
      strategy.recordInsert('key1');

      // When
      const exists = strategy.has('key2');

      // Then
      expect(exists).toBe(false);
    });

    it('should return false after key is deleted', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordDelete('key1');

      // When
      const exists = strategy.has('key1');

      // Then
      expect(exists).toBe(false);
    });

    it('should return false for empty strategy', () => {
      // Given/When
      const exists = strategy.has('key1');

      // Then
      expect(exists).toBe(false);
    });
  });

  describe('getKeys', () => {
    it('should return empty array for empty strategy', () => {
      // Given/When
      const keys = strategy.getKeys();

      // Then
      expect(keys).toEqual([]);
    });

    it('should return all keys in insertion order', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When
      const keys = strategy.getKeys();

      // Then
      expect(keys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should return copy of keys array', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      const keys = strategy.getKeys();
      keys.push('key3');

      // Then
      expect(strategy.getKeys()).toEqual(['key1', 'key2']);
      expect(strategy.size()).toBe(2);
    });
  });

  describe('FIFO behavior scenarios', () => {
    it('should maintain insertion order despite access patterns', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When - access keys in different order
      strategy.recordAccess('key3');
      strategy.recordAccess('key2');
      strategy.recordAccess('key1');

      // Then - order should remain based on insertion
      expect(strategy.getKeys()).toEqual(['key1', 'key2', 'key3']);
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should evict oldest even if recently accessed', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');
      strategy.recordInsert('key3');

      // When - access oldest key
      strategy.recordAccess('key1');

      // Then - oldest should still be victim
      expect(strategy.selectVictim()).toBe('key1');
    });

    it('should handle insert-delete-insert sequence', () => {
      // Given
      strategy.recordInsert('key1');
      strategy.recordInsert('key2');

      // When
      strategy.recordDelete('key1');
      strategy.recordInsert('key1');

      // Then - key1 should now be newest
      expect(strategy.getKeys()).toEqual(['key2', 'key1']);
      expect(strategy.selectVictim()).toBe('key2');
    });
  });
});
