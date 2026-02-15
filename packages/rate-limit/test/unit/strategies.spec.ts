import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FixedWindowStrategy } from '../../src/rate-limit/domain/strategies/fixed-window.strategy';
import { SlidingWindowStrategy } from '../../src/rate-limit/domain/strategies/sliding-window.strategy';
import { TokenBucketStrategy } from '../../src/rate-limit/domain/strategies/token-bucket.strategy';
import type { IRateLimitStore } from '../../src/rate-limit/application/ports/rate-limit-store.port';
import type { IRateLimitResult } from '../../src/shared/types';

function createMockStore(): IRateLimitStore {
  return {
    fixedWindow: vi.fn(),
    slidingWindow: vi.fn(),
    tokenBucket: vi.fn(),
    peek: vi.fn(),
    reset: vi.fn(),
  };
}

const mockResult: IRateLimitResult = {
  allowed: true,
  limit: 100,
  remaining: 99,
  reset: Math.floor(Date.now() / 1000) + 60,
  current: 1,
};

describe('Rate Limit Strategies', () => {
  describe('FixedWindowStrategy', () => {
    let strategy: FixedWindowStrategy;

    beforeEach(() => {
      strategy = new FixedWindowStrategy();
    });

    it('should have correct name', () => {
      // Given/When/Then
      expect(strategy.name).toBe('fixed-window');
    });

    it('should return Lua script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toBeTruthy();
      expect(script).toContain('KEYS[1]');
      expect(script).toContain('ARGV[1]');
      expect(script).toContain('ARGV[2]');
      expect(script).toContain('ARGV[3]');
    });

    it('should include INCR command in script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('INCR');
    });

    it('should include EXPIRE command in script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('EXPIRE');
    });

    it('should calculate window and reset time', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('window');
      expect(script).toContain('reset');
    });

    it('should throw error when check is called without store', async () => {
      // Given/When/Then
      await expect(strategy.check('key', { points: 10, duration: 60 })).rejects.toThrow('requires an IRateLimitStore');
    });

    it('should delegate check to store when store is provided', async () => {
      // Given
      const store = createMockStore();
      vi.mocked(store.fixedWindow).mockResolvedValue(mockResult);
      const strategyWithStore = new FixedWindowStrategy(store);

      // When
      const result = await strategyWithStore.check('key', { points: 50, duration: 30 });

      // Then
      expect(result).toEqual(mockResult);
      expect(store.fixedWindow).toHaveBeenCalledWith('key', 50, 30);
    });

    it('should return non-empty script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('SlidingWindowStrategy', () => {
    let strategy: SlidingWindowStrategy;

    beforeEach(() => {
      strategy = new SlidingWindowStrategy();
    });

    it('should have correct name', () => {
      // Given/When/Then
      expect(strategy.name).toBe('sliding-window');
    });

    it('should return Lua script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toBeTruthy();
      expect(script).toContain('KEYS[1]');
      expect(script).toContain('ARGV[1]');
      expect(script).toContain('ARGV[2]');
      expect(script).toContain('ARGV[3]');
      expect(script).toContain('ARGV[4]');
    });

    it('should use sorted set commands', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('ZREMRANGEBYSCORE');
      expect(script).toContain('ZCARD');
      expect(script).toContain('ZADD');
    });

    it('should include PEXPIRE for TTL', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('PEXPIRE');
    });

    it('should calculate retry time when limit exceeded', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('retry_after');
      expect(script).toContain('ZRANGE');
    });

    it('should throw error when check is called without store', async () => {
      // Given/When/Then
      await expect(strategy.check('key', { points: 10, duration: 60 })).rejects.toThrow('requires an IRateLimitStore');
    });

    it('should delegate check to store when store is provided', async () => {
      // Given
      const store = createMockStore();
      vi.mocked(store.slidingWindow).mockResolvedValue(mockResult);
      const strategyWithStore = new SlidingWindowStrategy(store);

      // When
      const result = await strategyWithStore.check('key', { points: 50, duration: 30 });

      // Then
      expect(result).toEqual(mockResult);
      expect(store.slidingWindow).toHaveBeenCalledWith('key', 50, 30);
    });

    it('should return non-empty script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('TokenBucketStrategy', () => {
    let strategy: TokenBucketStrategy;

    beforeEach(() => {
      strategy = new TokenBucketStrategy();
    });

    it('should have correct name', () => {
      // Given/When/Then
      expect(strategy.name).toBe('token-bucket');
    });

    it('should return Lua script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toBeTruthy();
      expect(script).toContain('KEYS[1]');
      expect(script).toContain('ARGV[1]');
      expect(script).toContain('ARGV[2]');
      expect(script).toContain('ARGV[3]');
      expect(script).toContain('ARGV[4]');
    });

    it('should use hash commands for state storage', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('HMGET');
      expect(script).toContain('HMSET');
    });

    it('should implement token refill logic', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('refill_rate');
      expect(script).toContain('refill');
      expect(script).toContain('elapsed');
    });

    it('should implement token consumption', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('consume');
      expect(script).toContain('tokens');
    });

    it('should include PEXPIRE for TTL', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('PEXPIRE');
    });

    it('should calculate retry time when bucket empty', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script).toContain('retry_after');
    });

    it('should throw error when check is called without store', async () => {
      // Given/When/Then
      await expect(strategy.check('key', { points: 10, duration: 60 })).rejects.toThrow('requires an IRateLimitStore');
    });

    it('should delegate check to store when store is provided', async () => {
      // Given
      const store = createMockStore();
      vi.mocked(store.tokenBucket).mockResolvedValue(mockResult);
      const strategyWithStore = new TokenBucketStrategy(store);

      // When
      const result = await strategyWithStore.check('key', { capacity: 100, refillRate: 10 });

      // Then
      expect(result).toEqual(mockResult);
      expect(store.tokenBucket).toHaveBeenCalledWith('key', 100, 10, 1);
    });

    it('should return non-empty script', () => {
      // Given/When
      const script = strategy.getScript();

      // Then
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('Strategy Comparison', () => {
    it('should have unique names for each strategy', () => {
      // Given
      const fixedWindow = new FixedWindowStrategy();
      const slidingWindow = new SlidingWindowStrategy();
      const tokenBucket = new TokenBucketStrategy();

      // When
      const names = [fixedWindow.name, slidingWindow.name, tokenBucket.name];

      // Then
      expect(new Set(names).size).toBe(3);
    });

    it('should all return non-empty scripts', () => {
      // Given
      const strategies = [new FixedWindowStrategy(), new SlidingWindowStrategy(), new TokenBucketStrategy()];

      // When/Then
      strategies.forEach((strategy) => {
        expect(strategy.getScript().length).toBeGreaterThan(0);
      });
    });

    it('should all throw error on direct check call without store', async () => {
      // Given
      const strategies = [new FixedWindowStrategy(), new SlidingWindowStrategy(), new TokenBucketStrategy()];
      const config = { points: 10, duration: 60 };

      // When/Then
      for (const strategy of strategies) {
        await expect(strategy.check('key', config)).rejects.toThrow('requires an IRateLimitStore');
      }
    });
  });
});
