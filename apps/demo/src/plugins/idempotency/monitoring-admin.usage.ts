import { Controller, Get, Inject, Param, NotFoundException } from '@nestjs/common';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';
import { IdempotencyStats } from './types';

@Controller('admin/idempotency')
export class IdempotencyAdminController {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotency: IIdempotencyService,
  ) {}

  @Get('stats')
  async getStats(): Promise<IdempotencyStats> {
    return {
      total: await this.countTotal(),
      byStatus: await this.countByStatus(),
      recentDuplicates: await this.getRecentDuplicates(),
      topKeys: await this.getTopKeys(),
    };
  }

  @Get('keys/:key')
  async getKeyDetails(@Param('key') key: string) {
    const record = await this.idempotency.get(key);

    if (!record) {
      throw new NotFoundException();
    }

    return {
      key: record.key,
      status: record.status,
      fingerprint: record.fingerprint,
      createdAt: record.startedAt,
      completedAt: record.completedAt,
    };
  }

  private async countTotal(): Promise<number> {
    return 0;
  }

  private async countByStatus(): Promise<Record<string, number>> {
    return {};
  }

  private async getRecentDuplicates(): Promise<unknown[]> {
    return [];
  }

  private async getTopKeys(): Promise<unknown[]> {
    return [];
  }
}
