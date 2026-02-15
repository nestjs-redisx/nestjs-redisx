import { Injectable, Controller, Post, Body, Res } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CreateOrderDto, OrderService, InventoryService, EmailService, WarehouseService, AnalyticsService, User } from '../types';

@Injectable()
@Controller()
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
    private readonly emailService: EmailService,
    private readonly warehouseService: WarehouseService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post('orders')
  @Idempotent({
    ttl: 3600,  // 1 hour
    cacheHeaders: ['Location', 'X-Order-Number'],
  })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @Res() res: any,
  ) {
    // All of these execute ONCE per idempotency key
    const order = await this.orderService.create({
      items: dto.items,
    });

    // Reserve inventory
    await this.inventoryService.reserve(order.items);

    // Send confirmation email
    await this.emailService.sendOrderConfirmation(order);

    // Notify warehouse
    await this.warehouseService.notifyNewOrder(order);

    // Track analytics
    await this.analyticsService.trackOrderCreated(order);

    res.setHeader('Location', `/orders/${order.id}`);
    res.setHeader('X-Order-Number', order.orderNumber);

    return res.status(201).json(order);
  }
}
