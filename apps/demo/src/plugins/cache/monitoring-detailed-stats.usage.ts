import { Inject, Injectable } from '@nestjs/common';
import {
  STAMPEDE_PROTECTION,
  SWR_MANAGER,
  type IStampedeProtection,
  type ISwrManager,
} from '@nestjs-redisx/cache';

@Injectable()
export class DetailedStatsService {
  constructor(
    @Inject(STAMPEDE_PROTECTION) private readonly stampede: IStampedeProtection,
    @Inject(SWR_MANAGER) private readonly swr: ISwrManager,
  ) {}

  getDetailedStats() {
    const stampedeStats = this.stampede.getStats();
    // { activeFlights, totalWaiters, oldestFlight, prevented }

    const swrStats = this.swr.getStats();
    // { activeRevalidations, enabled, staleTtl }

    return { stampede: stampedeStats, swr: swrStats };
  }
}
