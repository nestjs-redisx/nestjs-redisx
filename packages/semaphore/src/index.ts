// Plugin
export { SemaphorePlugin } from './semaphore.plugin';

// Services
export { SemaphoreService } from './semaphore/application/services/semaphore.service';

// Ports (Interfaces)
export type { ISemaphoreService } from './semaphore/application/ports/semaphore-service.port';
export type { ISemaphoreStore } from './semaphore/application/ports/semaphore-store.port';
export type { ISemaphorePermit } from './semaphore/domain/entities/semaphore-permit.entity';

// Decorators
export { WithSemaphore, WITH_SEMAPHORE_OPTIONS, registerSemaphoreServiceGetter, type IWithSemaphoreOptions } from './semaphore/api/decorators/with-semaphore.decorator';

// Types
export type { ISemaphorePluginOptions, SemaphorePluginOptions, ISemaphoreOptions } from './shared/types';

// Errors
export { SemaphoreError, SemaphoreAcquisitionError, SemaphorePermitNotHeldError, SemaphoreExtensionError, InvalidSemaphoreConfigError } from './shared/errors';

// Constants
export { SEMAPHORE_SERVICE, SEMAPHORE_STORE, SEMAPHORE_REDIS_DRIVER, SEMAPHORE_PLUGIN_OPTIONS } from './shared/constants';
