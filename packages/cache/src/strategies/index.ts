/**
 * Cache eviction strategies.
 *
 * @example
 * ```typescript
 * import { LruStrategy, FifoStrategy } from '@nestjs-redisx/cache';
 *
 * const lru = new LruStrategy<string>();
 * lru.recordInsert('key1');
 * lru.recordInsert('key2');
 * lru.recordAccess('key1');
 * const victim = lru.selectVictim(); // Returns 'key2'
 * ```
 */

export type { IEvictionStrategy } from './eviction-strategy.interface';
export { LruStrategy } from './lru.strategy';
export { FifoStrategy } from './fifo.strategy';
export { LfuStrategy } from './lfu.strategy';
