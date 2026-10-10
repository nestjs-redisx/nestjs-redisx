import { Injectable } from '@nestjs/common';
import { WithSemaphore } from '@nestjs-redisx/semaphore';
import { VideoEncoder } from './types';

@Injectable()
export class EncodingService {
  constructor(private readonly encoder: VideoEncoder) {}

  // At most 2 encodes at a time ACROSS EVERY INSTANCE - the fleet-wide
  // analogue of a bounded worker pool.
  @WithSemaphore({ key: 'video:encode', permits: 2, ttl: 600_000 })
  async encode(videoId: string): Promise<void> {
    await this.encoder.encode(videoId);
  }

  // Per-tenant bound via a {n} key template; saturation skips instead of
  // throwing (good for periodic retried work).
  @WithSemaphore({
    key: 'export:{0}',
    permits: 1,
    waitTimeout: 5_000,
    onUnavailable: 'skip',
  })
  async exportTenant(tenantId: string): Promise<void> {
    // runs at most once concurrently per tenant
  }
}
