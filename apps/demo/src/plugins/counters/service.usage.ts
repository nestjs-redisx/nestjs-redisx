import { Injectable, Inject } from '@nestjs/common';
import { COUNTER_SERVICE, ICounterService } from '@nestjs-redisx/counters';

@Injectable()
export class StatsService {
  constructor(
    @Inject(COUNTER_SERVICE)
    private readonly counters: ICounterService,
  ) {}

  // Atomic fleet-wide increment — concurrent updates never get lost.
  async onArticleView(articleId: string): Promise<number> {
    return this.counters.increment(`views:${articleId}`);
  }

  async getViews(articleId: string): Promise<number> {
    return this.counters.get(`views:${articleId}`); // 0 when absent
  }

  // Counters go negative freely — clamp in domain code if needed.
  async releaseSeat(eventId: string): Promise<number> {
    return this.counters.decrement(`seats:${eventId}`);
  }

  async resetViews(articleId: string): Promise<boolean> {
    return this.counters.reset(`views:${articleId}`);
  }
}
