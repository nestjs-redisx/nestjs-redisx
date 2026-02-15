import { IRateLimitResult } from '../../../shared/types';
import { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { TOKEN_BUCKET_SCRIPT } from '../../infrastructure/scripts/lua-scripts';
import { IRateLimitStrategy, IStrategyConfig } from './rate-limit-strategy.interface';

/**
 * Token bucket rate limiting strategy.
 *
 * Smooth rate limiting with burst allowance.
 * Pros: Smooth limiting, configurable burst
 * Cons: More complex
 */
export class TokenBucketStrategy implements IRateLimitStrategy {
  readonly name = 'token-bucket' as const;

  constructor(private readonly store?: IRateLimitStore) {}

  getScript(): string {
    return TOKEN_BUCKET_SCRIPT;
  }

  async check(key: string, config: IStrategyConfig): Promise<IRateLimitResult> {
    if (!this.store) {
      throw new Error('TokenBucketStrategy requires an IRateLimitStore. Pass it via constructor or use RateLimitService instead.');
    }

    const capacity = config.capacity ?? config.points ?? 100;
    const refillRate = config.refillRate ?? (config.duration ? capacity / config.duration : 10);

    return this.store.tokenBucket(key, capacity, refillRate, 1);
  }
}
