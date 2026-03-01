// Plugin
export { IdempotencyPlugin } from './idempotency.plugin';

// Services
export { IdempotencyService } from './idempotency/application/services/idempotency.service';

// Ports (Interfaces)
export type { IIdempotencyService } from './idempotency/application/ports/idempotency-service.port';
export type { IIdempotencyStore } from './idempotency/application/ports/idempotency-store.port';

// Decorators
export { Idempotent, type IIdempotentOptions, IDEMPOTENT_OPTIONS } from './idempotency/api/decorators/idempotent.decorator';

// Interceptors
export { IdempotencyInterceptor } from './idempotency/api/interceptors/idempotency.interceptor';

// Types
export type { IIdempotencyPluginOptions, IIdempotencyRecord, IIdempotencyCheckResult, IIdempotencyResponse, IIdempotencyOptions } from './shared/types';

// Errors
export { IdempotencyError, IdempotencyKeyRequiredError, IdempotencyFingerprintMismatchError, IdempotencyTimeoutError, IdempotencyFailedError, IdempotencyRecordNotFoundError } from './shared/errors';

// Constants
export { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_REDIS_DRIVER, IDEMPOTENCY_SERVICE, IDEMPOTENCY_STORE } from './shared/constants';
