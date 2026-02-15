/**
 * @fileoverview Demo module for @nestjs-redisx/streams.
 */

import { Module } from '@nestjs/common';
import { StreamsDemoController } from './streams-demo.controller';
import { StreamsProducerService } from './streams-producer.service';
import { StreamsConsumerService } from './streams-consumer.service';

@Module({
  controllers: [StreamsDemoController],
  providers: [StreamsProducerService, StreamsConsumerService],
})
export class StreamsDemoModule {}
