import { Injectable } from '@nestjs/common';
import { IRedisXPlugin, IPluginContext } from '@nestjs-redisx/core';

@Injectable()
class SomeService {}

export class ContextDemoPlugin implements IRedisXPlugin {
  readonly name = 'context-demo';
  readonly version = '1.0.0';

  async onModuleInit(context: IPluginContext) {
    // Check if another plugin is available
    if (context.hasPlugin('metrics')) {
      const metrics = context.getPlugin('metrics');
      context.logger.info('Metrics plugin detected');
    }

    // Access global config
    const prefix = context.config.global?.keyPrefix;

    // Check client existence and get client
    if (context.clientManager.hasClient('cache')) {
      const client = await context.clientManager.getClient('cache');
    }

    // List all registered clients
    const clientNames = context.clientManager.getClientNames();

    // Get the default client
    const defaultClient = await context.clientManager.getClient();

    // Use NestJS DI for advanced cases
    const someService = context.moduleRef.get(SomeService);
  }
}
