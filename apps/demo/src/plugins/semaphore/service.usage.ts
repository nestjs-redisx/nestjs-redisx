import { Injectable, Inject } from '@nestjs/common';
import { SEMAPHORE_SERVICE, ISemaphoreService } from '@nestjs-redisx/semaphore';
import { LegacyApiClient } from './types';

@Injectable()
export class ReportService {
  constructor(
    @Inject(SEMAPHORE_SERVICE)
    private readonly semaphore: ISemaphoreService,
    private readonly legacyApi: LegacyApiClient,
  ) {}

  // withPermit: acquire -> run -> always release.
  async fetchReport(tenantId: string): Promise<unknown> {
    return this.semaphore.withPermit('legacy-api', 5, () => this.legacyApi.fetchReport(tenantId));
  }

  // Manual permit lifecycle for long multi-step work.
  async fetchWithManualPermit(tenantId: string): Promise<unknown> {
    const permit = await this.semaphore.acquire('legacy-api', 5, {
      ttl: 60_000,
      waitTimeout: 10_000, // give up if no seat frees up in 10s
    });
    try {
      return await this.legacyApi.fetchReport(tenantId);
    } finally {
      await permit.release();
    }
  }

  // tryAcquire: skip this round instead of waiting.
  async fetchIfCapacity(tenantId: string): Promise<unknown | undefined> {
    const permit = await this.semaphore.tryAcquire('legacy-api', 5);
    if (!permit) {
      return undefined; // at capacity - caller decides what to do
    }
    try {
      return await this.legacyApi.fetchReport(tenantId);
    } finally {
      await permit.release();
    }
  }
}
