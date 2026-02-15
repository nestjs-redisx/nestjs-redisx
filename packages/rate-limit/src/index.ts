// Plugin
export { RateLimitPlugin } from './rate-limit.plugin';

// Services
export { RateLimitService } from './rate-limit/application/services/rate-limit.service';

// Ports (Interfaces)
export type { IRateLimitService } from './rate-limit/application/ports/rate-limit-service.port';

// Decorators
export { RateLimit, type IRateLimitOptions, RATE_LIMIT_OPTIONS, type KeyExtractor } from './rate-limit/api/decorators/rate-limit.decorator';

// Guards
export { RateLimitGuard } from './rate-limit/api/guards/rate-limit.guard';

// Filters
export { RateLimitExceptionFilter } from './rate-limit/api/filters/rate-limit-exception.filter';

// Types
export type { IRateLimitPluginOptions, RateLimitConfig, RateLimitResult, RateLimitState } from './shared/types';

// Errors
export { RateLimitError, RateLimitExceededError, RateLimitScriptError } from './shared/errors';

// Constants
export { RATE_LIMIT_PLUGIN_OPTIONS, RATE_LIMIT_SERVICE, RATE_LIMIT_STORE } from './shared/constants';

// Strategies
export type { IRateLimitStrategy, IStrategyConfig } from './rate-limit/domain/strategies/rate-limit-strategy.interface';
export { FixedWindowStrategy } from './rate-limit/domain/strategies/fixed-window.strategy';
export { SlidingWindowStrategy } from './rate-limit/domain/strategies/sliding-window.strategy';
export { TokenBucketStrategy } from './rate-limit/domain/strategies/token-bucket.strategy';
