import { IRateLimitResult } from '../../../shared/types';
import { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { SLIDING_WINDOW_SCRIPT } from '../../infrastructure/scripts/lua-scripts';
import { IRateLimitStrategy, IStrategyConfig } from './rate-limit-strategy.interface';

/**
 * Sliding window log rate limiting strategy.
 *
 * Tracks individual request timestamps for precise limiting.
 * Pros: Accurate, no boundary issues
 * Cons: Higher memory usage
 */
export class SlidingWindowStrategy implements IRateLimitStrategy {
  readonly name = 'sliding-window' as const;

  constructor(private readonly store?: IRateLimitStore) {}

  getScript(): string {
    return SLIDING_WINDOW_SCRIPT;
  }

  async check(key: string, config: IStrategyConfig): Promise<IRateLimitResult> {
    if (!this.store) {
      throw new Error('SlidingWindowStrategy requires an IRateLimitStore. Pass it via constructor or use RateLimitService instead.');
    }

    const points = config.points ?? 100;
    const duration = config.duration ?? 60;

    return this.store.slidingWindow(key, points, duration);
  }
}
