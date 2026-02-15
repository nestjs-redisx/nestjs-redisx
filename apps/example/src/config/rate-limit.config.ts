/**
 * @fileoverview Rate limiting plugin configuration.
 */

import { ConfigService } from '@nestjs/config';
import { IRateLimitPluginOptions } from '@nestjs-redisx/rate-limit';

export const rateLimitConfig = (
  config: ConfigService,
): IRateLimitPluginOptions => ({
  keyPrefix: 'ratelimit:',
  defaultAlgorithm: 'sliding-window',

  defaultPoints: 100, // 100 requests
  defaultDuration: 60, // per 60 seconds

  includeHeaders: true,
  headers: {
    limit: 'X-RateLimit-Limit',
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    retryAfter: 'Retry-After',
  },

  defaultKeyExtractor: 'ip',
});
