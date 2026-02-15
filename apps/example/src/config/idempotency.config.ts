/**
 * @fileoverview Idempotency plugin configuration.
 */

import { ConfigService } from '@nestjs/config';
import { IIdempotencyPluginOptions } from '@nestjs-redisx/idempotency';

export const idempotencyConfig = (
  config: ConfigService,
): IIdempotencyPluginOptions => ({
  keyPrefix: 'idempotency:',
  headerName: 'Idempotency-Key',
  defaultTtl: 86400, // 24 hours

  validateFingerprint: true,
  fingerprintFields: ['method', 'path', 'body'],

  lockTimeout: 30000,
  waitTimeout: 60000,

  errorPolicy: 'fail-closed',
});
