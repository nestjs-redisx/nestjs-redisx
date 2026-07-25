import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { PUBSUB_SERVICE, IPubSubService, IPubSubSubscription } from '@nestjs-redisx/pubsub';
import { OrderEvent } from './types';

@Injectable()
export class OrderFeed implements OnModuleInit {
  private subscription?: IPubSubSubscription;

  constructor(
    @Inject(PUBSUB_SERVICE)
    private readonly pubsub: IPubSubService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Programmatic subscription with a typed handler.
    this.subscription = await this.pubsub.subscribe<OrderEvent>('order.updated', (message) => {
      console.log(`order ${message.data.orderId} -> ${message.data.status}`);
    });
  }

  async pause(): Promise<void> {
    // Releases the Redis subscription when this was the last handler.
    await this.subscription?.unsubscribe();
  }

  activeChannels(): string[] {
    return this.pubsub.getSubscriptions().channels;
  }
}
