import { Controller, Get, Inject } from '@nestjs/common';
import { CLIENT_MANAGER, RedisClientManager, IConnectionStats } from '@nestjs-redisx/core';

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  @Get('redis/stats')
  getRedisStats(): IConnectionStats {
    return this.clientManager.getStats();
  }
}
