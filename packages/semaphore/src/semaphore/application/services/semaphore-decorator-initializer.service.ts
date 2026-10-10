/**
 * Initializes the @WithSemaphore decorator with lazy service injection.
 *
 * Registers a getter at bootstrap and withdraws it on destroy, so late calls
 * on a closed application execute without a bound (observable fallback)
 * instead of consulting a torn-down service.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';

import { SEMAPHORE_SERVICE } from '../../../shared/constants';
import { registerSemaphoreServiceGetter } from '../../api/decorators/with-semaphore.decorator';
import { ISemaphoreService } from '../ports/semaphore-service.port';

@Injectable()
export class SemaphoreDecoratorInitializerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemaphoreDecoratorInitializerService.name);

  constructor(@Inject(SEMAPHORE_SERVICE) private readonly semaphoreService: ISemaphoreService) {}

  onModuleInit(): void {
    registerSemaphoreServiceGetter(() => this.semaphoreService);
    this.logger.log('@WithSemaphore decorator initialized and ready to use');
  }

  onModuleDestroy(): void {
    registerSemaphoreServiceGetter(null);
  }
}
