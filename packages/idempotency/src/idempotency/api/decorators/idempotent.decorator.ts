import { applyDecorators, SetMetadata, UseInterceptors, ExecutionContext } from '@nestjs/common';

import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor';

export const IDEMPOTENT_OPTIONS = Symbol.for('IDEMPOTENT_OPTIONS');

export interface IIdempotentOptions {
  ttl?: number;
  keyExtractor?: (context: ExecutionContext) => string | Promise<string>;
  fingerprintFields?: ('method' | 'path' | 'body' | 'query')[];
  validateFingerprint?: boolean;
  cacheHeaders?: string[];
  skip?: (context: ExecutionContext) => boolean | Promise<boolean>;
}

export function Idempotent(options: IIdempotentOptions = {}): MethodDecorator {
  return applyDecorators(SetMetadata(IDEMPOTENT_OPTIONS, options), UseInterceptors(IdempotencyInterceptor));
}
