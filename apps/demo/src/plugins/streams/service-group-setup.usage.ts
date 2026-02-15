import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { STREAM_CONSUMER, IStreamConsumer } from '@nestjs-redisx/streams';

@Injectable()
export class StreamSetup implements OnModuleInit {
  constructor(
    @Inject(STREAM_CONSUMER) private readonly consumer: IStreamConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    // Start from beginning
    await this.consumer.createGroup('orders', 'processors', '0');

    // Start from end (new messages only)
    await this.consumer.createGroup('orders', 'analytics', '$');

    // Start from specific ID
    await this.consumer.createGroup(
      'orders',
      'audit',
      '1706123456789-0'
    );
  }
}
