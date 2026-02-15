import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IRedisModuleOptions, IRedisModuleOptionsFactory } from '@nestjs-redisx/core';

@Injectable()
export class RedisConfigService implements IRedisModuleOptionsFactory {
  constructor(private config: ConfigService) {}

  createRedisModuleOptions(): IRedisModuleOptions {
    return {
      clients: {
        host: this.config.get<string>('REDIS_HOST'),
        port: this.config.get<number>('REDIS_PORT'),
      },
    };
  }
}
