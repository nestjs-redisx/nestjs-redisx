import { Injectable, Provider } from '@nestjs/common';
import { IRedisXPlugin, IPluginContext } from '@nestjs-redisx/core';

interface MyPluginOptions {
  defaultTimeout?: number;
}

const MY_OPTIONS = Symbol('MY_OPTIONS');
const MY_SERVICE = Symbol('MY_SERVICE');

@Injectable()
class MyPluginService {}

export class MyPlugin implements IRedisXPlugin {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';
  readonly description = 'Example custom plugin';

  constructor(private readonly options: MyPluginOptions = {}) {}

  getProviders(): Provider[] {
    return [
      { provide: MY_OPTIONS, useValue: this.options },
      { provide: MY_SERVICE, useClass: MyPluginService },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [MY_SERVICE];
  }

  async onRegister(context: IPluginContext): Promise<void> {
    context.logger.info('Plugin registered');
  }

  async onModuleInit(context: IPluginContext): Promise<void> {
    context.logger.info('Plugin initialized');
  }

  async onModuleDestroy(context: IPluginContext): Promise<void> {
    context.logger.info('Plugin destroyed');
  }
}
