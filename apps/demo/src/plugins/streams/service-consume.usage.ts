import { Injectable } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { OrderEvent, FulfillmentService } from './types';

@Injectable()
export class OrderProcessor {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @StreamConsumer({
    stream: 'orders',
    group: 'order-processors',
    batchSize: 10,
  })
  async handleOrder(message: IStreamMessage<OrderEvent>): Promise<void> {
    const { orderId } = message.data;

    try {
      await this.fulfillmentService.process(orderId);
      await message.ack();
    } catch (error) {
      await message.reject(error);
    }
  }
}
