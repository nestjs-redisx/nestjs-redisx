/**
 * @fileoverview Redis Streams plugin configuration.
 */

import { ConfigService } from '@nestjs/config';
import { IStreamsPluginOptions } from '@nestjs-redisx/streams';

export const streamsConfig = (
  config: ConfigService,
): IStreamsPluginOptions => ({
  consumer: {
    batchSize: 10,
    blockTimeout: 5000,
    concurrency: 5,
    maxRetries: 3,
    claimIdleTimeout: 60000,
  },

  dlq: {
    enabled: true,
    streamSuffix: ':dlq',
    maxLen: 10000,
  },

  producer: {
    maxLen: 100000,
    autoCreate: true,
  },
});
