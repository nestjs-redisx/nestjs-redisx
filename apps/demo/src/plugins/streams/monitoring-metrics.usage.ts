import { Injectable } from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class StreamMetrics {
  // Counter: Total messages published
  readonly messagesPublished = new promClient.Counter({
    name: 'stream_messages_published_total',
    help: 'Total messages published to streams',
    labelNames: ['stream'],
  });

  // Counter: Total messages processed
  readonly messagesProcessed = new promClient.Counter({
    name: 'stream_messages_processed_total',
    help: 'Total messages processed',
    labelNames: ['stream', 'group', 'status'],
  });

  // Gauge: Current stream length
  readonly streamLength = new promClient.Gauge({
    name: 'stream_length',
    help: 'Current number of messages in stream',
    labelNames: ['stream'],
  });

  // Gauge: Consumer lag
  readonly consumerLag = new promClient.Gauge({
    name: 'stream_consumer_lag',
    help: 'Number of messages waiting to be processed',
    labelNames: ['stream', 'group'],
  });

  // Gauge: Pending messages
  readonly pendingMessages = new promClient.Gauge({
    name: 'stream_pending_messages',
    help: 'Messages delivered but not acknowledged',
    labelNames: ['stream', 'group'],
  });

  // Histogram: Processing duration
  readonly processingDuration = new promClient.Histogram({
    name: 'stream_message_processing_duration_seconds',
    help: 'Message processing duration',
    labelNames: ['stream', 'group'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  });

  // Gauge: DLQ size
  readonly dlqSize = new promClient.Gauge({
    name: 'stream_dlq_size',
    help: 'Number of messages in DLQ',
    labelNames: ['stream'],
  });
}
