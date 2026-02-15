import { Injectable } from '@nestjs/common';
import { Cached } from '@nestjs-redisx/cache';
import { TenantData, DataRepository } from '../types';

@Injectable()
export class TenantDataService {
  constructor(private readonly repository: DataRepository) {}

  @Cached({
    key: 'data:{0}',              // {0} = dataId
    varyBy: ['tenantId'],          // resolved from contextProvider, appended to key
    ttl: 600,
    tags: (dataId: string) => [`data:${dataId}`],
  })
  async getData(dataId: string): Promise<TenantData> {
    // tenantId comes from context (CLS), not as method argument
    return this.repository.findOne(dataId);
  }
}
