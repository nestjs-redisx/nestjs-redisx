/**
 * @fileoverview Distributed locks plugin configuration.
 */

import { ConfigService } from '@nestjs/config';
import { ILocksPluginOptions } from '@nestjs-redisx/locks';

export const locksConfig = (config: ConfigService): ILocksPluginOptions => ({
  keyPrefix: 'lock:',
  defaultTtl: 30000, // TTL: 30 seconds

  // Auto-Renewal
  autoRenew: {
    enabled: true,
    intervalFraction: 0.5, // Renew when < 50% TTL remaining
  },

  // Retry Strategy
  retry: {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    multiplier: 2,
  },
});
