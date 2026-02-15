import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class SentinelService {
  constructor(private readonly redis: RedisService) {}

  async getMasters(): Promise<unknown> {
    const client = await this.redis.getClient();
    return client.sentinel('MASTERS');
  }

  async getMaster(name: string): Promise<unknown> {
    const client = await this.redis.getClient();
    return client.sentinel('MASTER', name);
  }

  async getReplicas(masterName: string): Promise<unknown> {
    const client = await this.redis.getClient();
    return client.sentinel('REPLICAS', masterName);
  }
}
