import { Injectable, Inject } from '@nestjs/common';
import { getClientToken, IRedisDriver } from '@nestjs-redisx/core';

// Get token for specific client
const CACHE_CLIENT = getClientToken('cache');

@Injectable()
export class CacheService {
  constructor(
    @Inject(CACHE_CLIENT)
    private readonly cache: IRedisDriver,
  ) {}
}
