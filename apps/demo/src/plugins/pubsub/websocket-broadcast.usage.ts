import { Injectable } from '@nestjs/common';
import { Subscribe, IPubSubMessage } from '@nestjs-redisx/pubsub';
import { NotificationGateway } from './types';

/**
 * Fan out server events to WebSocket clients on EVERY instance: each instance
 * subscribes to the same channel, so a message published anywhere reaches all
 * connected sockets cluster-wide.
 */
@Injectable()
export class RealtimeBridge {
  constructor(private readonly gateway: NotificationGateway) {}

  @Subscribe('broadcast.notifications')
  onNotification(message: IPubSubMessage<{ userId: string; text: string }>): void {
    this.gateway.broadcast(`notify:${message.data.userId}`, message.data);
  }
}
