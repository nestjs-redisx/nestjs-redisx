/**
 * @fileoverview Controller demonstrating integration of all modules.
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';
import { IntegrationDemoService } from './integration-demo.service';

@Controller('demo/integration')
export class IntegrationDemoController {
  constructor(private readonly integrationDemo: IntegrationDemoService) {}

  /**
   * Process an order (all modules together).
   *
   * Uses:
   * - Rate Limit: 5 req/min
   * - Idempotency: prevent duplicates
   * - Lock: prevent parallel processing
   * - Cache: cache the result
   * - Streams: publish event
   * - Tracing: distributed tracing
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/integration/order \
   *   -H "Content-Type: application/json" \
   *   -H "Idempotency-Key: order-12345" \
   *   -d '{"orderId": "ORD-12345"}'
   * ```
   */
  @Post('order')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 5, duration: 60 })
  async order(@Body() body: { orderId: string }) {
    return this.integrationDemo.processOrder(body.orderId);
  }
}
