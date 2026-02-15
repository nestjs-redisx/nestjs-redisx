import { Injectable, Inject } from '@nestjs/common';
import {
  CLIENT_MANAGER,
  RedisClientManager,
  IConnectionStats,
} from '@nestjs-redisx/core';

@Injectable()
export class MultiClientService {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  getClientNames(): string[] {
    return this.clientManager.getClientNames();
  }

  async healthCheckAll() {
    return this.clientManager.healthCheck();
  }

  getStats(): IConnectionStats {
    return this.clientManager.getStats();
  }

  async addClient(name: string, host: string, port: number): Promise<void> {
    await this.clientManager.createClient(name, { host, port });
  }

  getClientInfo(name: string) {
    return this.clientManager.getMetadata(name);
  }
}
