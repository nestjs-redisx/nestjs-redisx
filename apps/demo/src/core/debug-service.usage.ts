import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class DebugService {
  constructor(private readonly redis: RedisService) {}

  async testConnection(): Promise<{
    connected: boolean;
    latency: number;
    serverInfo: string;
  }> {
    const start = Date.now();

    try {
      const pong = await this.redis.ping();
      const latency = Date.now() - start;
      const info = await this.redis.info('server');

      return {
        connected: pong === 'PONG',
        latency,
        serverInfo: info,
      };
    } catch (error) {
      return {
        connected: false,
        latency: -1,
        serverInfo: error.message,
      };
    }
  }
}
