import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import {
  OrderEvent,
  CreateOrderDto,
  Order,
  OrderRepository,
  PaymentService,
  InventoryService,
  ShippingService,
} from '../types';

@Injectable()
export class OrderPipeline {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly orderRepo: OrderRepository,
    private readonly paymentService: PaymentService,
    private readonly inventoryService: InventoryService,
    private readonly shippingService: ShippingService,
  ) {}

  // Step 1: Create Order
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.orderRepo.create(dto);

    await this.producer.publish('orders', {
      type: 'ORDER_CREATED',
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      total: order.total,
    });

    return order;
  }

  // Step 2: Process Payment
  @StreamConsumer({ stream: 'orders', group: 'payment-processor' })
  async processPayment(message: IStreamMessage<OrderEvent>): Promise<void> {
    if (message.data.type !== 'ORDER_CREATED') {
      await message.ack();
      return;
    }

    try {
      const payment = await this.paymentService.charge({
        orderId: message.data.orderId,
        amount: message.data.total,
      });

      await this.producer.publish('orders', {
        type: 'PAYMENT_COMPLETED',
        orderId: message.data.orderId,
        paymentId: payment.id,
      });

      await message.ack();
    } catch (error) {
      await this.producer.publish('orders', {
        type: 'PAYMENT_FAILED',
        orderId: message.data.orderId,
        error: (error as Error).message,
      });

      await message.reject(error as Error);
    }
  }

  // Step 3: Reserve Inventory
  @StreamConsumer({ stream: 'orders', group: 'inventory-manager' })
  async reserveInventory(message: IStreamMessage<OrderEvent>): Promise<void> {
    if (message.data.type !== 'PAYMENT_COMPLETED') {
      await message.ack();
      return;
    }

    try {
      await this.inventoryService.reserve(message.data.orderId);

      await this.producer.publish('orders', {
        type: 'INVENTORY_RESERVED',
        orderId: message.data.orderId,
      });

      await message.ack();
    } catch (error) {
      // Refund payment and fail order
      await this.paymentService.refund(message.data.paymentId);

      await this.producer.publish('orders', {
        type: 'ORDER_FAILED',
        orderId: message.data.orderId,
        error: 'Inventory unavailable',
      });

      await message.reject(error as Error);
    }
  }

  // Step 4: Ship Order
  @StreamConsumer({ stream: 'orders', group: 'shipping' })
  async shipOrder(message: IStreamMessage<OrderEvent>): Promise<void> {
    if (message.data.type !== 'INVENTORY_RESERVED') {
      await message.ack();
      return;
    }

    await this.shippingService.createShipment(message.data.orderId);

    await this.producer.publish('orders', {
      type: 'ORDER_SHIPPED',
      orderId: message.data.orderId,
    });

    await message.ack();
  }
}
