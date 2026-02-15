import { Injectable, Inject } from '@nestjs/common';
import { TRACING_SERVICE, ITracingService } from '@nestjs-redisx/tracing';
import { CreateOrderDto, Order, OrderRepository, PaymentService } from '../types';

@Injectable()
export class OrderService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
    private readonly orderRepo: OrderRepository,
    private readonly paymentService: PaymentService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    return this.tracing.withSpan('order.create', async () => {
      this.tracing.setAttribute('order.total', dto.total);
      this.tracing.setAttribute('order.items_count', dto.items.length);
      this.tracing.setAttribute('customer.id', dto.customerId);

      // Validate
      await this.tracing.withSpan('order.validate', async () => {
        this.tracing.addEvent('validation.started');
        await this.validateOrder(dto);
        this.tracing.addEvent('validation.completed');
      });

      // Create order
      const order = await this.tracing.withSpan('order.save', async () => {
        this.tracing.setAttribute('db.operation', 'INSERT');
        return this.orderRepo.create(dto);
      });

      // Process payment
      await this.tracing.withSpan('payment.process', async () => {
        this.tracing.setAttribute('payment.method', dto.paymentMethod);
        this.tracing.setAttribute('payment.amount', dto.total);

        try {
          await this.paymentService.charge(order.id, dto.total);
          this.tracing.addEvent('payment.succeeded');
        } catch (error) {
          this.tracing.addEvent('payment.failed', {
            'error.type': (error as Error).name,
            'error.message': (error as Error).message,
          });
          this.tracing.recordException(error as Error);
          throw error;
        }
      });

      return order;
    });
  }

  private async validateOrder(_dto: CreateOrderDto): Promise<void> {
    // validation logic
  }
}
