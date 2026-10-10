import { Injectable, Inject } from '@nestjs/common';
import { COUNTER_SERVICE, ICounterService } from '@nestjs-redisx/counters';

@Injectable()
export class UsageService {
  constructor(
    @Inject(COUNTER_SERVICE)
    private readonly counters: ICounterService,
  ) {}

  // Window counter: the TTL applies only when the increment CREATES the
  // key - later increments never extend the window, so daily keys expire
  // on their own without a cleanup job.
  async onApiCall(userId: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    return this.counters.increment(`api:${userId}:${today}`, 1, { ttl: 86_400_000 });
  }

  // Flush-style consumption: read the accumulated total and zero it in ONE
  // atomic step - periodic aggregation without double counting.
  async flushEmailBatch(): Promise<number> {
    return this.counters.getAndReset('emails:batch');
  }
}
