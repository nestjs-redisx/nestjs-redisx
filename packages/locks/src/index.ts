// Plugin
export { LocksPlugin } from './locks.plugin';

// Services
export { LockService } from './lock/application/services/lock.service';

// Ports (Interfaces)
export type { ILockService } from './lock/application/ports/lock-service.port';
export type { ILock } from './lock/domain/entities/lock.entity';

// Decorators
export { WithLock, type IWithLockOptions } from './lock/api/decorators/with-lock.decorator';

// Types
export type { ILocksPluginOptions, LocksPluginOptions, ILockOptions } from './shared/types';

// Errors
export { LockError, LockAcquisitionError, LockNotOwnedError, LockExtensionError, LockExpiredError } from './shared/errors';

// Constants
export { LOCK_SERVICE, LOCKS_PLUGIN_OPTIONS } from './shared/constants';
