/**
 * AMQP event source adapter.
 * Integrates with RabbitMQ using @golevelup/nestjs-rabbitmq.
 * This is an optional adapter that requires @golevelup/nestjs-rabbitmq to be installed.
 */

import { Injectable, Inject, OnModuleInit, Logger, Optional } from '@nestjs/common';

import { AMQP_CONNECTION, CACHE_PLUGIN_OPTIONS, EVENT_INVALIDATION_SERVICE } from '../../../shared/constants';
import { ICachePluginOptions } from '../../../shared/types';
import { IEventInvalidationService } from '../../application/ports/event-invalidation.port';

interface IInvalidationMessage {
  payload: unknown;
  timestamp?: number;
  source?: string;
}

/**
 * AMQP connection interface (from @golevelup/nestjs-rabbitmq).
 * Using minimal interface to avoid tight coupling with the external library.
 */
interface IAMQPConnection {
  createSubscriber(
    handler: (msg: IInvalidationMessage, rawMsg: IRawMessage) => Promise<void>,
    options: {
      exchange: string;
      queue: string;
      routingKey: string[];
      queueOptions: { durable: boolean };
    },
  ): Promise<void>;
}

/**
 * Raw AMQP message interface.
 */
interface IRawMessage {
  fields: {
    routingKey: string;
  };
}

/**
 * AMQP Event Source Adapter.
 * Note: This adapter requires @golevelup/nestjs-rabbitmq to be installed.
 * If not available, the adapter will log a warning and do nothing.
 */
@Injectable()
export class AMQPEventSourceAdapter implements OnModuleInit {
  private readonly logger = new Logger(AMQPEventSourceAdapter.name);
  private amqpConnection: IAMQPConnection | undefined;

  constructor(
    @Inject(EVENT_INVALIDATION_SERVICE)
    private readonly invalidationService: IEventInvalidationService,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly config: ICachePluginOptions,
    @Optional() @Inject(AMQP_CONNECTION) amqpConnection?: IAMQPConnection,
  ) {
    this.amqpConnection = amqpConnection;
  }

  async onModuleInit(): Promise<void> {
    const source = this.config.invalidation?.source;

    if (source !== 'amqp') {
      return;
    }

    if (!this.amqpConnection) {
      this.logger.warn('AMQP source configured but @golevelup/nestjs-rabbitmq is not available. ' + 'Install it with: npm install @golevelup/nestjs-rabbitmq');
      return;
    }

    const amqpConfig = this.config.invalidation?.amqp;
    if (!amqpConfig) {
      this.logger.warn('AMQP source configured but amqp config is missing');
      return;
    }

    const exchange = amqpConfig.exchange ?? 'cache.invalidation';
    const queue = amqpConfig.queue ?? `${this.getServiceName()}.cache.invalidation`;
    const routingKeys = amqpConfig.routingKeys ?? ['#'];

    try {
      // Subscribe to invalidation events
      await this.amqpConnection.createSubscriber(
        async (msg: IInvalidationMessage, rawMsg: IRawMessage) => {
          const routingKey = rawMsg.fields.routingKey;
          this.logger.debug(`Received AMQP invalidation event: ${routingKey}`);
          await this.invalidationService.processEvent(routingKey, msg.payload);
        },
        {
          exchange,
          queue,
          routingKey: routingKeys,
          queueOptions: {
            durable: true,
          },
        },
      );

      this.logger.log(`AMQP event source initialized: exchange=${exchange}, queue=${queue}, routingKeys=${routingKeys.join(',')}`);
    } catch (error) {
      this.logger.error('Failed to setup AMQP event source:', error);
      throw error;
    }
  }

  private getServiceName(): string {
    return process.env.SERVICE_NAME ?? 'app';
  }
}
