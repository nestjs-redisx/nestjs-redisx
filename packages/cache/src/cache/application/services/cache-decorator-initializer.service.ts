/**
 * Service for initializing @Cached decorator with lazy cache service injection.
 *
 * Runs on module initialization and registers a getter function that provides
 * access to CacheService for the @Cached decorator's proxy logic.
 */

import { Injectable, OnModuleInit, Inject, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { IEventInvalidationService } from '../../../invalidation/application/ports/event-invalidation.port';
import { registerEventInvalidationServiceGetter } from '../../../invalidation/infrastructure/decorators/invalidate-on.decorator';
import { CACHE_SERVICE, CACHE_PLUGIN_OPTIONS, EVENT_INVALIDATION_SERVICE } from '../../../shared/constants';
import { ICachePluginOptions } from '../../../shared/types';
import { registerCacheServiceGetter, registerCachePluginOptions } from '../../api/decorators/cached.decorator';
import { ICacheService } from '../ports/cache-service.port';

@Injectable()
export class CacheDecoratorInitializerService implements OnModuleInit {
  private readonly logger = new Logger(CacheDecoratorInitializerService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(CACHE_SERVICE) private readonly cacheService: ICacheService,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly pluginOptions: ICachePluginOptions,
    @Optional() @Inject(EVENT_INVALIDATION_SERVICE) private readonly eventInvalidationService?: IEventInvalidationService,
  ) {}

  /**
   * Called after all modules are initialized.
   * Registers cache service getter and plugin options for @Cached decorator.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit(): Promise<void> {
    this.logger.debug('Registering CacheService getter for @Cached decorator');

    // Register getter that provides cache service to decorator
    registerCacheServiceGetter(() => this.cacheService);

    // Register plugin options for context enrichment in decorators
    registerCachePluginOptions(this.pluginOptions);

    this.logger.log('@Cached decorator initialized and ready to use');

    // Register event invalidation service getter for @InvalidateOn decorator
    if (this.eventInvalidationService) {
      this.logger.debug('Registering EventInvalidationService getter for @InvalidateOn decorator');
      registerEventInvalidationServiceGetter(() => this.eventInvalidationService!);
      this.logger.log('@InvalidateOn decorator event publishing initialized');
    }
  }
}
