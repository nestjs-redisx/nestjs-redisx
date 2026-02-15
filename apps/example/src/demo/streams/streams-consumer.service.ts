/**
 * @fileoverview Stream Consumer demo.
 *
 * Shows:
 * - Using the @StreamConsumer decorator
 * - Automatic message processing from Redis Streams
 * - Consumer groups for distributed processing
 */

import { Injectable, Logger } from '@nestjs/common';
import { StreamConsumer } from '@nestjs-redisx/streams';

@Injectable()
export class StreamsConsumerService {
  private readonly logger = new Logger(StreamsConsumerService.name);

  /**
   * Consumer for processing orders.
   *
   * Automatically subscribes to the 'orders' stream and processes messages.
   *
   * @example
   * ```bash
   * # Send a message
   * curl -X POST http://localhost:3000/demo/streams/publish \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "stream": "orders",
   *     "data": {
   *       "type": "order.created",
   *       "payload": { "orderId": "ORD-123", "amount": 100.50 }
   *     }
   *   }'
   *
   * # Consumer will automatically process the message
   * ```
   */
  @StreamConsumer({
    stream: 'orders',
    group: 'order-processors',
    consumer: 'processor-1',
  })
  async handleOrder(message: { type: string; payload: any }) {
    this.logger.log(`Processing order: ${JSON.stringify(message)}`);

    // Simulate order processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.logger.log(`Order processed: ${message.payload?.orderId}`);
  }

  /**
   * Consumer for processing notifications.
   *
   * @example
   * ```bash
   * # Send a notification
   * curl -X POST http://localhost:3000/demo/streams/publish \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "stream": "notifications",
   *     "data": {
   *       "type": "notification.email",
   *       "payload": { "to": "user@example.com", "subject": "Welcome" }
   *     }
   *   }'
   * ```
   */
  @StreamConsumer({
    stream: 'notifications',
    group: 'notification-handlers',
  })
  async handleNotification(message: { type: string; payload: any }) {
    this.logger.log(`Sending notification: ${message.type}`);

    // Simulate sending notification
    await new Promise((resolve) => setTimeout(resolve, 50));

    this.logger.log(`Notification sent to: ${message.payload?.to}`);
  }

  /**
   * Consumer for processing user events.
   *
   * @example
   * ```bash
   * # Send an event
   * curl -X POST http://localhost:3000/demo/streams/publish \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "stream": "user-events",
   *     "data": {
   *       "type": "user.registered",
   *       "payload": { "userId": "123", "email": "new@example.com" }
   *     }
   *   }'
   * ```
   */
  @StreamConsumer({
    stream: 'user-events',
    group: 'analytics',
    maxRetries: 3,
  })
  async handleUserEvent(message: { type: string; payload: any }) {
    this.logger.log(`User event: ${message.type}`);

    // Simulate analytics
    await new Promise((resolve) => setTimeout(resolve, 30));

    this.logger.log(
      `Analytics tracked for user: ${message.payload?.userId}`,
    );
  }
}
