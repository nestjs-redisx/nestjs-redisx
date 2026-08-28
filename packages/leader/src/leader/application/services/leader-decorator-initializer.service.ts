/**
 * Registers the lazy service getter that powers the @LeaderOnly decorator.
 *
 * The decorator wraps methods at class-load time, before the DI container
 * exists; this initializer hands it a getter once LeaderService is available.
 */

import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';

import { LEADER_SERVICE } from '../../../shared/constants';
import { registerLeaderServiceGetter } from '../../api/decorators/leader-only.decorator';
import { ILeaderService } from '../ports/leader-service.port';

@Injectable()
export class LeaderDecoratorInitializerService implements OnModuleInit {
  private readonly logger = new Logger(LeaderDecoratorInitializerService.name);

  constructor(@Inject(LEADER_SERVICE) private readonly leaderService: ILeaderService) {}

  onModuleInit(): void {
    registerLeaderServiceGetter(() => this.leaderService);
    this.logger.log('@LeaderOnly decorator initialized and ready to use');
  }
}
