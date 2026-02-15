/**
 * Service for initializing @WithLock decorator with lazy lock service injection.
 *
 * Runs on module initialization and registers a getter function that provides
 * access to LockService for the @WithLock decorator's proxy logic.
 */

import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';

import { LOCK_SERVICE } from '../../../shared/constants';
import { registerLockServiceGetter } from '../../api/decorators/with-lock.decorator';
import { ILockService } from '../ports/lock-service.port';

@Injectable()
export class LockDecoratorInitializerService implements OnModuleInit {
  private readonly logger = new Logger(LockDecoratorInitializerService.name);

  constructor(@Inject(LOCK_SERVICE) private readonly lockService: ILockService) {}

  /**
   * Called after all modules are initialized.
   * Registers lock service getter for @WithLock decorator.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit(): Promise<void> {
    this.logger.debug('Registering LockService getter for @WithLock decorator');

    // Register getter that provides lock service to decorator
    registerLockServiceGetter(() => this.lockService);

    this.logger.log('@WithLock decorator initialized and ready to use');
  }
}
