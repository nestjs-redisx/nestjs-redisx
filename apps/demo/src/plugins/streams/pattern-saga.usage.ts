import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import {
  SagaEvent,
  CreateOrderDto,
  OrderRepository,
  PaymentService,
  InventoryService,
} from './types';

@Injectable()
export class OrderSaga {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly orderRepo: OrderRepository,
    private readonly paymentService: PaymentService,
    private readonly inventoryService: InventoryService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<void> {
    const order = await this.orderRepo.create(dto);

    await this.producer.publish('orders', {
      type: 'ORDER_CREATED',
      orderId: order.id,
      sagaId: `saga-${Date.now()}`,
      step: 'PAYMENT',
      data: order,
    });
  }

  // Step 2: Process Payment
  @StreamConsumer({ stream: 'orders', group: 'payment-processor' })
  async processPayment(message: IStreamMessage<SagaEvent>): Promise<void> {
    if (message.data.step !== 'PAYMENT') return await message.ack();

    try {
      await this.paymentService.charge(message.data.data);

      await this.producer.publish('orders', {
        type: 'PAYMENT_COMPLETED',
        sagaId: message.data.sagaId,
        step: 'INVENTORY',
        data: message.data.data,
      });

      await message.ack();
    } catch (error) {
      await this.producer.publish('orders', {
        type: 'PAYMENT_FAILED',
        sagaId: message.data.sagaId,
        step: 'ROLLBACK',
        data: message.data.data,
      });

      await message.ack();
    }
  }

  // Step 3: Reserve Inventory
  @StreamConsumer({ stream: 'orders', group: 'inventory-processor' })
  async reserveInventory(message: IStreamMessage<SagaEvent>): Promise<void> {
    if (message.data.step !== 'INVENTORY') return await message.ack();

    try {
      await this.inventoryService.reserve(message.data.data);

      await this.producer.publish('orders', {
        type: 'INVENTORY_RESERVED',
        sagaId: message.data.sagaId,
        step: 'NOTIFY',
        data: message.data.data,
      });

      await message.ack();
    } catch (error) {
      await this.producer.publish('orders', {
        type: 'INVENTORY_FAILED',
        sagaId: message.data.sagaId,
        step: 'ROLLBACK',
        data: message.data.data,
      });

      await message.ack();
    }
  }

  // Rollback Handler
  @StreamConsumer({ stream: 'orders', group: 'rollback-processor' })
  async handleRollback(message: IStreamMessage<SagaEvent>): Promise<void> {
    if (message.data.step !== 'ROLLBACK') return await message.ack();

    // Rollback based on how far we got
    if (message.data.type === 'PAYMENT_FAILED') {
      await this.orderRepo.cancel(message.data.data.orderId);
    } else if (message.data.type === 'INVENTORY_FAILED') {
      await this.paymentService.refund(message.data.data);
      await this.orderRepo.cancel(message.data.data.orderId);
    }

    await message.ack();
  }
}
