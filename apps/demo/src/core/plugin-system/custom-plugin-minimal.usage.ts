import { Injectable, Provider } from '@nestjs/common';
import { IRedisXPlugin } from '@nestjs-redisx/core';

@Injectable()
class MyService {}

export class MyPlugin implements IRedisXPlugin {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';

  getProviders(): Provider[] {
    return [{ provide: 'MY_SERVICE', useClass: MyService }];
  }

  getExports(): Array<string | symbol> {
    return ['MY_SERVICE'];
  }
}
