/**
 * @fileoverview Controller demonstrating idempotency.
 *
 * Endpoints:
 * - POST /demo/idempotency/payment - Idempotent payment
 * - POST /demo/idempotency/order - Idempotent order
 * - POST /demo/idempotency/custom - Custom key
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  ExecutionContext,
} from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { IdempotencyDemoService } from './idempotency-demo.service';

@Controller('demo/idempotency')
export class IdempotencyDemoController {
  constructor(private readonly idempotencyDemo: IdempotencyDemoService) {}

  /**
   * Simple test endpoint.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/idempotency/test
   * ```
   */
  @Get('test')
  async test() {
    return {
      status: 'ok',
      plugin: 'idempotency',
      message: 'Idempotency plugin is working',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a payment (idempotent).
   *
   * Repeat requests with the same Idempotency-Key return
   * the cached result without re-execution.
   *
   * @example
   * ```bash
   * # First request
   * curl -X POST http://localhost:3000/demo/idempotency/payment \
   *   -H "Content-Type: application/json" \
   *   -H "Idempotency-Key: payment-123" \
   *   -d '{
   *     "amount": 100.50,
   *     "currency": "USD",
   *     "customerId": "cust_123"
   *   }'
   *
   * # Repeat request with the same key
   * curl -X POST http://localhost:3000/demo/idempotency/payment \
   *   -H "Content-Type: application/json" \
   *   -H "Idempotency-Key: payment-123" \
   *   -d '{
   *     "amount": 100.50,
   *     "currency": "USD",
   *     "customerId": "cust_123"
   *   }'
   *
   * # Returns the same transactionId without re-execution
   * ```
   */
  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @Idempotent({ ttl: 86400 })
  async payment(
    @Body()
    dto: {
      amount: number;
      currency: string;
      customerId: string;
    },
  ) {
    return this.idempotencyDemo.createPayment(dto);
  }

  /**
   * Create an order (idempotent).
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/idempotency/order \
   *   -H "Content-Type: application/json" \
   *   -H "Idempotency-Key: order-456" \
   *   -d '{
   *     "customerId": "cust_123",
   *     "items": [
   *       {"productId": "prod_1", "quantity": 2},
   *       {"productId": "prod_2", "quantity": 1}
   *     ]
   *   }'
   * ```
   */
  @Post('order')
  @HttpCode(HttpStatus.OK)
  @Idempotent({ ttl: 3600 })
  async order(
    @Body()
    dto: {
      customerId: string;
      items: Array<{ productId: string; quantity: number }>;
    },
  ) {
    return this.idempotencyDemo.createOrder(dto);
  }

  /**
   * Operation with a custom idempotency key.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/idempotency/custom \
   *   -H "Content-Type: application/json" \
   *   -H "X-Custom-Idempotency-Key: my-custom-key-789" \
   *   -d '{"data": "some data"}'
   * ```
   */
  @Post('custom')
  @HttpCode(HttpStatus.OK)
  @Idempotent({
    ttl: 1800,
    keyExtractor: (context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest();
      return request.headers['x-custom-idempotency-key'] || 'default';
    },
  })
  async custom(@Body() body: { customKey?: string; data: any }) {
    return this.idempotencyDemo.customKeyOperation(
      body.customKey || 'default',
      body.data,
    );
  }
}
