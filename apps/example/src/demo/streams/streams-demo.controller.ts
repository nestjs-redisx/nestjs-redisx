/**
 * @fileoverview Controller demonstrating Redis Streams.
 *
 * Endpoints:
 * - POST /demo/streams/publish - Publish a message
 * - POST /demo/streams/publish-batch - Batch publish
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { StreamsProducerService } from './streams-producer.service';

@Controller('demo/streams')
export class StreamsDemoController {
  constructor(private readonly producer: StreamsProducerService) {}

  /**
   * Publish an event to a stream.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/streams/publish \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "stream": "orders",
   *     "event": {
   *       "type": "order.created",
   *       "payload": {"orderId": "123", "amount": 99.99},
   *       "timestamp": 1234567890
   *     }
   *   }'
   * ```
   */
  @Post('publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Body()
    body: {
      stream: string;
      event: { type: string; payload: any; timestamp: number };
    },
  ) {
    return this.producer.publishEvent(body.stream, body.event);
  }

  /**
   * Publish a batch of events.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/streams/publish-batch \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "stream": "notifications",
   *     "events": [
   *       {"type": "email.sent", "payload": {"to": "user1@example.com"}, "timestamp": 1234567890},
   *       {"type": "email.sent", "payload": {"to": "user2@example.com"}, "timestamp": 1234567891},
   *       {"type": "email.sent", "payload": {"to": "user3@example.com"}, "timestamp": 1234567892}
   *     ]
   *   }'
   * ```
   */
  @Post('publish-batch')
  @HttpCode(HttpStatus.OK)
  async publishBatch(
    @Body()
    body: {
      stream: string;
      events: Array<{ type: string; payload: any; timestamp: number }>;
    },
  ) {
    return this.producer.publishBatch(body.stream, body.events);
  }
}
