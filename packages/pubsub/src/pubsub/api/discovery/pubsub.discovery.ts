import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';

import { PUBSUB_SERVICE } from '../../../shared/constants';
import { IPubSubService } from '../../application/ports/pubsub-service.port';
import { PUBSUB_SUBSCRIBE_METADATA, ISubscribeOptions } from '../decorators/subscribe.decorator';

/**
 * Discovers `@Subscribe`-decorated provider methods on startup and registers
 * them with the Pub/Sub service (mirrors the streams consumer discovery).
 */
@Injectable()
export class PubSubDiscovery implements OnModuleInit {
  private readonly logger = new Logger(PubSubDiscovery.name);

  constructor(
    @Optional() @Inject(DiscoveryService) private readonly discoveryService: DiscoveryService | null,
    @Inject(PUBSUB_SERVICE) private readonly pubSubService: IPubSubService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.discoveryService) {
      this.logger.warn('DiscoveryService not available. Import DiscoveryModule from @nestjs/core to enable the @Subscribe decorator.');
      return;
    }

    const providers = this.discoveryService.getProviders();
    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance) {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance);
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
        if (!descriptor || typeof descriptor.value !== 'function') {
          continue;
        }

        const options = this.reflector.get<ISubscribeOptions>(PUBSUB_SUBSCRIBE_METADATA, descriptor.value);
        if (options) {
          await this.register(instance, methodName, options);
        }
      }
    }
  }

  private async register(instance: object, methodName: string, options: ISubscribeOptions): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const handler = ((instance as Record<string, Function>)[methodName] as Function).bind(instance);

    if (options.pattern) {
      await this.pubSubService.psubscribe(options.pattern, handler);
      this.logger.log(`Subscribed ${instance.constructor.name}.${methodName} to pattern "${options.pattern}"`);
    } else {
      await this.pubSubService.subscribe(options.channel!, handler);
      this.logger.log(`Subscribed ${instance.constructor.name}.${methodName} to channel "${options.channel}"`);
    }
  }
}
