/**
 * @fileoverview Producer service for Redis Streams.
 *
 * Sends messages to streams.
 */

import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, type IStreamProducer } from '@nestjs-redisx/streams';

/** System event */
export interface Event {
  type: string;
  payload: any;
  timestamp: number;
}

@Injectable()
export class StreamsProducerService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
  ) {}

  /**
   * Publish a single message.
   *
   * @param stream - Stream name
   * @param event - Event
   * @returns Message ID
   */
  async publishEvent(stream: string, event: Event) {
    const messageId = await this.producer.publish(stream, event);

    return {
      success: true,
      stream,
      messageId,
      event,
    };
  }

  /**
   * Publish a batch of messages.
   *
   * @param stream - Stream name
   * @param events - Array of events
   * @returns Array of message IDs
   */
  async publishBatch(stream: string, events: Event[]) {
    const messageIds = await Promise.all(
      events.map((event) => this.producer.publish(stream, event)),
    );

    return {
      success: true,
      stream,
      messageIds,
      count: events.length,
    };
  }
}
