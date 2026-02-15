import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class ClusterService {
  constructor(private readonly redis: RedisService) {}

  async getClusterInfo(): Promise<string> {
    const client = await this.redis.getClient();
    return client.cluster('INFO') as Promise<string>;
  }

  async getClusterNodes(): Promise<string> {
    const client = await this.redis.getClient();
    return client.cluster('NODES') as Promise<string>;
  }

  async getClusterSlots(): Promise<unknown> {
    const client = await this.redis.getClient();
    return client.cluster('SLOTS');
  }
}
