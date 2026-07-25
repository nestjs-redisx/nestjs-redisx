import { Injectable } from '@nestjs/common';
import { Subscribe, IPubSubMessage } from '@nestjs-redisx/pubsub';
import { UserCreatedEvent, NotificationGateway } from './types';

@Injectable()
export class UserEventsHandler {
  constructor(private readonly gateway: NotificationGateway) {}

  // Auto-subscribed on startup via discovery.
  @Subscribe('user.created')
  onUserCreated(message: IPubSubMessage<UserCreatedEvent>): void {
    this.gateway.broadcast('user:new', message.data);
  }

  // Redis glob patterns: *, ?, [..]
  @Subscribe({ pattern: 'order.*' })
  onAnyOrderEvent(message: IPubSubMessage): void {
    // message.pattern === 'order.*', message.channel === concrete channel
    this.gateway.broadcast(message.channel, message.data);
  }
}
