import { IRateLimitResult } from '../../../shared/types';
import { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { FIXED_WINDOW_SCRIPT } from '../../infrastructure/scripts/lua-scripts';
import { IRateLimitStrategy, IStrategyConfig } from './rate-limit-strategy.interface';

/**
 * Fixed window rate limiting strategy.
 *
 * Simple counter that resets at fixed intervals.
 * Pros: Simple, low memory
 * Cons: Burst at window boundaries
 */
export class FixedWindowStrategy implements IRateLimitStrategy {
  readonly name = 'fixed-window' as const;

  constructor(private readonly store?: IRateLimitStore) {}

  getScript(): string {
    return FIXED_WINDOW_SCRIPT;
  }

  async check(key: string, config: IStrategyConfig): Promise<IRateLimitResult> {
    if (!this.store) {
      throw new Error('FixedWindowStrategy requires an IRateLimitStore. Pass it via constructor or use RateLimitService instead.');
    }

    const points = config.points ?? 100;
    const duration = config.duration ?? 60;

    return this.store.fixedWindow(key, points, duration);
  }
}
