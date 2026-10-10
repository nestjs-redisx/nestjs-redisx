import { Injectable, Inject } from '@nestjs/common';
import { LEADER_SERVICE, ILeaderService } from '@nestjs-redisx/leader';

@Injectable()
export class LeadershipStatusService {
  constructor(
    @Inject(LEADER_SERVICE)
    private readonly leaderService: ILeaderService,
  ) {}

  // Synchronous local view - safe to call on every request.
  isThisInstanceTheLeader(): boolean {
    return this.leaderService.isLeader();
  }

  // Works on ANY instance: reads the election key from Redis.
  async whoLeads(): Promise<string | null> {
    return this.leaderService.getLeaderId();
  }

  // Execute singleton work programmatically (without a decorator).
  async maybeCompact(): Promise<number | undefined> {
    return this.leaderService.runIfLeader(async () => {
      // ...heavy singleton work...
      return 42;
    });
  }

  status() {
    return {
      instanceId: this.leaderService.instanceId,
      isLeader: this.leaderService.isLeader(),
      groups: this.leaderService.getGroups(),
    };
  }
}
