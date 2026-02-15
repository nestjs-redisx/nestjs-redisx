import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import {
  CLIENT_MANAGER,
  RedisClientManager,
  ManagerEvent,
} from '@nestjs-redisx/core';

@Injectable()
export class RedisMonitor implements OnModuleInit {
  private readonly logger = new Logger(RedisMonitor.name);

  constructor(
    @Inject(CLIENT_MANAGER)
    private readonly clientManager: RedisClientManager,
  ) {}

  onModuleInit(): void {
    this.clientManager.on(ManagerEvent.CONNECTED, (data) => {
      this.logger.log(`Redis client '${data.name}' connected`);
    });

    this.clientManager.on(ManagerEvent.DISCONNECTED, (data) => {
      this.logger.warn(`Redis client '${data.name}' disconnected`);
    });

    this.clientManager.on(ManagerEvent.RECONNECTING, (data) => {
      this.logger.log(
        `Redis client '${data.name}' reconnecting (attempt ${data.metadata?.attempt})`,
      );
    });

    this.clientManager.on(ManagerEvent.ERROR, (data) => {
      this.logger.error(
        `Redis client '${data.name}' error: ${data.error?.message}`,
      );
    });
  }
}
