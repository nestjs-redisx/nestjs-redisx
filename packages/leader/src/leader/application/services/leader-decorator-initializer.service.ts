/**
 * Registers the lazy service getter that powers the @LeaderOnly decorator.
 *
 * The decorator wraps methods at class-load time, before the DI container
 * exists; this initializer hands it a getter once LeaderService is available,
 * and withdraws it on shutdown so a destroyed application can no longer
 * answer leadership checks.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';

import { LEADER_SERVICE } from '../../../shared/constants';
import { registerLeaderServiceGetter, unregisterLeaderServiceGetter } from '../../api/decorators/leader-only.decorator';
import { ILeaderService } from '../ports/leader-service.port';

@Injectable()
export class LeaderDecoratorInitializerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderDecoratorInitializerService.name);

  /** Stable identity so destroy can unregister exactly what init registered. */
  private readonly getter = (): ILeaderService => this.leaderService;

  constructor(@Inject(LEADER_SERVICE) private readonly leaderService: ILeaderService) {}

  onModuleInit(): void {
    registerLeaderServiceGetter(this.getter);
    this.logger.log('@LeaderOnly decorator initialized and ready to use');
  }

  onModuleDestroy(): void {
    // Identity-guarded: never clobbers a getter a newer initializer
    // registered (two Nest apps in one process). Late cron ticks then skip
    // fail-safe instead of consulting the destroyed service.
    unregisterLeaderServiceGetter(this.getter);
  }
}
