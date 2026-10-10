/**
 * Initializes the @Dedupe decorator with lazy service injection.
 *
 * Registers a getter at bootstrap and withdraws it on destroy, so late
 * calls on a closed application execute without deduplication (observable
 * fallback) instead of consulting a torn-down service.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';

import { DEDUP_SERVICE } from '../../../shared/constants';
import { registerDedupServiceGetter } from '../../api/decorators/dedupe.decorator';
import { IDedupService } from '../ports/dedup-service.port';

@Injectable()
export class DedupDecoratorInitializerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DedupDecoratorInitializerService.name);

  constructor(@Inject(DEDUP_SERVICE) private readonly dedupService: IDedupService) {}

  onModuleInit(): void {
    registerDedupServiceGetter(() => this.dedupService);
    this.logger.log('@Dedupe decorator initialized and ready to use');
  }

  onModuleDestroy(): void {
    registerDedupServiceGetter(null);
  }
}
