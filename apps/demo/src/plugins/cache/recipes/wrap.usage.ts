import { Injectable, OnModuleInit } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';
import { ConfigValue, ConfigRepository } from '../types';

@Injectable()
export class ConfigService implements OnModuleInit {
  private getCachedConfig: (key: string) => Promise<ConfigValue>;

  constructor(
    private readonly cache: CacheService,
    private readonly repository: ConfigRepository,
  ) {}

  onModuleInit() {
    // Create once in onModuleInit — avoids re-creating closures per request
    this.getCachedConfig = this.cache.wrap(
      (key: string) => this.repository.findByKey(key),
      {
        key: (key: string) => `config:${key}`,
        ttl: 600,
        tags: (key: string) => [`config:${key}`, 'config'],
      },
    );
  }

  async get(key: string): Promise<ConfigValue> {
    return this.getCachedConfig(key);
  }
}
