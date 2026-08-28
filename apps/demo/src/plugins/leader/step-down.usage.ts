import { Injectable, Inject } from '@nestjs/common';
import { LEADER_SERVICE, ILeaderService } from '@nestjs-redisx/leader';

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(LEADER_SERVICE)
    private readonly leaderService: ILeaderService,
  ) {}

  /**
   * Before planned maintenance of this node: release the lease and abstain
   * from candidacy for one ttlMs, so another instance takes over immediately
   * instead of waiting for the lease to expire.
   */
  async drainThisNode(): Promise<void> {
    await this.leaderService.stepDown();
    // Optionally also for named groups:
    await this.leaderService.stepDown('cleanup');
  }
}
