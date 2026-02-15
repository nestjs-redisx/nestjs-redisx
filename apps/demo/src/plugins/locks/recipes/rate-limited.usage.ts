import { Injectable } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';
import { Data, ExternalApiClient } from '../types';

@Injectable()
export class ExternalApiService {
  constructor(private readonly externalApi: ExternalApiClient) {}

  @WithLock({
    key: 'api:ratelimit',
    ttl: 1000, // 1 second window
    onLockFailed: 'skip',
  })
  async callRateLimitedApi(): Promise<Data> {
    // Only allow one call per second globally
    return this.externalApi.call();
  }
}
