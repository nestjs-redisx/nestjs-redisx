import { Injectable } from '@nestjs/common';
import { CacheService, hashKey, KeyBuilder } from '@nestjs-redisx/cache';
import { CalculateRequestDto } from './types';

@Injectable()
export class CalculationService {
  constructor(private readonly cache: CacheService) {}

  async calculate(body: CalculateRequestDto): Promise<unknown> {
    // hashKey: stable hash of the whole DTO — {a:1,b:2} and {b:2,a:1}
    // produce the SAME key (object keys are sorted recursively).
    const key = `calc:${hashKey(body)}`;

    return this.cache.getOrSet(key, () => this.compute(body), { ttl: 300 });
  }

  async invalidate(body: CalculateRequestDto): Promise<void> {
    // The hash is deterministic, so the same body always maps to the
    // same key — usable for targeted deletes too.
    await this.cache.del(`calc:${hashKey(body)}`);
  }

  buildVersionedKey(body: CalculateRequestDto): string {
    // Same algorithm via the fluent builder.
    return KeyBuilder.create().prefix('calc').version('v2').hashStable(body).build();
    // 'calc:v2:<16-hex-hash>'
  }

  private async compute(body: CalculateRequestDto): Promise<unknown> {
    return { input: body };
  }
}
