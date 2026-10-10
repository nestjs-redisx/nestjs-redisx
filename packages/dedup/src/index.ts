// Plugin
export { DedupPlugin } from './dedup.plugin';

// Services
export { DedupService } from './dedup/application/services/dedup.service';

// Ports (Interfaces)
export type { IDedupService } from './dedup/application/ports/dedup-service.port';
export type { IDedupStore } from './dedup/application/ports/dedup-store.port';

// Decorators
export { Dedupe, DEDUPE_OPTIONS, registerDedupServiceGetter, type IDedupeOptions } from './dedup/api/decorators/dedupe.decorator';

// Types
export type { IDedupPluginOptions, DedupPluginOptions, IDedupOptions, IDebounceOptions } from './shared/types';

// Errors
export { DedupError, InvalidDedupConfigError, DedupStoreError } from './shared/errors';

// Constants
export { DEDUP_SERVICE, DEDUP_STORE, DEDUP_REDIS_DRIVER, DEDUP_PLUGIN_OPTIONS } from './shared/constants';
