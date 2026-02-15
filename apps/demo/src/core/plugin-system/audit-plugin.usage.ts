import { IRedisXPlugin, IPluginContext } from '@nestjs-redisx/core';

export class AuditPlugin implements IRedisXPlugin {
  readonly name = 'audit';
  readonly version = '1.0.0';
  readonly dependencies = ['cache']; // Depends on cache plugin

  async onModuleInit(context: IPluginContext) {
    // CachePlugin.onModuleInit() is guaranteed to have run already
    const cache = context.getPlugin('cache');
  }

  async onModuleDestroy(context: IPluginContext) {
    // CachePlugin is still alive here
    // AuditPlugin shuts down BEFORE CachePlugin
  }
}
