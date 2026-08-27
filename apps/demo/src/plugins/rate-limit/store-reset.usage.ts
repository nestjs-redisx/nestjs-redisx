import { Injectable, Inject } from '@nestjs/common';
import { RATE_LIMIT_SERVICE, IRateLimitService } from '@nestjs-redisx/rate-limit';

@Injectable()
export class AdminService {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
  ) {}

  async unblockUser(userId: string): Promise<void> {
    // Default: sweeps BOTH stores across all algorithm variants.
    // Redis-backed keys are cleared globally; the memory store is cleared
    // only on the instance that handles this call (other instances keep
    // their short-lived local counters until the window expires).
    await this.rateLimitService.reset(`user:${userId}`);
  }

  async unblockLogin(email: string): Promise<void> {
    // Target one store when you know where the key is counted.
    await this.rateLimitService.reset(`login:${email}`, { store: 'redis' });
  }

  async inspect(userId: string) {
    // peek/getState honor the store selection too.
    const distributed = await this.rateLimitService.peek(`user:${userId}`, {
      store: 'redis',
      points: 100,
      duration: 60,
    });
    const local = await this.rateLimitService.peek(`user:${userId}`, {
      store: 'memory',
      points: 100,
      duration: 60,
    });

    return {
      distributed: distributed.current,
      // NOTE: per-instance value — only this node's view of the counter
      localOnThisInstance: local.current,
    };
  }
}
