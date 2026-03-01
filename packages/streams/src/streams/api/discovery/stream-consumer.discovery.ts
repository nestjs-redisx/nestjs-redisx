import * as os from 'os';

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { DiscoveryService, Reflector, ModuleRef } from '@nestjs/core';

import { STREAM_CONSUMER } from '../../../shared/constants';
import { IConsumerHandle, IStreamConsumerOptions } from '../../../shared/types';
import { IStreamConsumer } from '../../application/ports/stream-consumer.port';
import { STREAM_CONSUMER_METADATA } from '../decorators/stream-consumer.decorator';

@Injectable()
export class StreamConsumerDiscovery implements OnModuleInit {
  private readonly logger = new Logger(StreamConsumerDiscovery.name);
  private readonly handles: IConsumerHandle[] = [];

  constructor(
    @Optional() @Inject(DiscoveryService) private readonly discoveryService: DiscoveryService | null,
    @Inject(STREAM_CONSUMER) private readonly consumerService: IStreamConsumer,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    // If DiscoveryService is not available, skip discovery
    // This can happen if DiscoveryModule is not imported
    if (!this.discoveryService) {
      this.logger.warn('DiscoveryService not available. ' + 'Import DiscoveryModule from @nestjs/core to enable @StreamConsumer decorator.');
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

        const method = descriptor.value;
        const options = this.reflector.get<IStreamConsumerOptions & { methodName: string }>(STREAM_CONSUMER_METADATA, method);
        if (options) {
          await this.registerConsumer(instance, methodName, options);
        }
      }
    }
  }

  private async registerConsumer(instance: object, methodName: string, options: IStreamConsumerOptions): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const method = (instance as Record<string, Function>)[methodName];
    if (!method || typeof method !== 'function') {
      throw new Error(`Method ${methodName} is not a function on instance`);
    }
    const handler = method.bind(instance);
    const consumer = options.consumer ?? `${os.hostname()}-${process.pid}`;

    await this.consumerService.createGroup(options.stream, options.group);
    const handle = this.consumerService.consume(options.stream, options.group, consumer, handler, options);
    this.handles.push(handle);
  }
}
