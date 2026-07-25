import { Injectable, Inject } from '@nestjs/common';
import { PUBSUB_SERVICE, IPubSubService } from '@nestjs-redisx/pubsub';
import { UserCreatedEvent } from './types';

@Injectable()
export class UserPublisher {
  constructor(
    @Inject(PUBSUB_SERVICE)
    private readonly pubsub: IPubSubService,
  ) {}

  async userCreated(user: UserCreatedEvent): Promise<void> {
    // Payload is JSON-serialized; returns the number of subscribers reached.
    const receivers = await this.pubsub.publish('user.created', user);
    if (receivers === 0) {
      // Pub/Sub is fire-and-forget: nobody was listening right now.
    }
  }
}
