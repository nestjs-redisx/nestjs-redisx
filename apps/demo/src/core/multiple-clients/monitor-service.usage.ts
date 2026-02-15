import { Injectable, Inject } from '@nestjs/common';
import { CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

@Injectable()
export class MonitorService {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  async checkClient(name: string): Promise<boolean> {
    const client = await this.clientManager.getClient(name);
    return client.isConnected();
  }

  async checkAll(): Promise<Record<string, boolean>> {
    const names = this.clientManager.getClientNames();
    const status: Record<string, boolean> = {};

    for (const name of names) {
      const client = await this.clientManager.getClient(name);
      status[name] = client.isConnected();
    }

    return status;
  }
}
