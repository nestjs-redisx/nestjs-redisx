/**
 * @fileoverview Service demonstrating integration of all modules.
 *
 * Shows how modules work together in real-world scenarios.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Cached } from '@nestjs-redisx/cache';
import { WithLock } from '@nestjs-redisx/locks';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { STREAM_PRODUCER, type IStreamProducer } from '@nestjs-redisx/streams';
import { TRACING_SERVICE, type ITracingService } from '@nestjs-redisx/tracing';

@Injectable()
export class IntegrationDemoService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
  ) {}

  /**
   * Full order processing flow:
   * - Idempotency (prevent duplicates)
   * - Lock (prevent parallel processing)
   * - Cache (result)
   * - Streams (event publishing)
   * - Tracing (distributed tracing)
   *
   * @param orderId - Order ID
   */
  @Idempotent({ ttl: 3600 })
  @WithLock({ key: 'order:{0}', ttl: 30000 })
  @Cached({ key: 'order-result:{0}', ttl: 1800 })
  async processOrder(orderId: string) {
    return this.tracing.withSpan('process-order', async () => {
      this.tracing.setAttribute('orderId', orderId);

      // 1. Validation
      await this.delay(100);
      this.tracing.addEvent('order-validated');

      // 2. Payment processing
      await this.delay(200);
      this.tracing.addEvent('payment-processed');

      // 3. Inventory reservation
      await this.delay(150);
      this.tracing.addEvent('inventory-reserved');

      // 4. Event publishing
      await this.producer.publish('orders', {
        type: 'order.completed',
        orderId,
        timestamp: Date.now(),
      });
      this.tracing.addEvent('event-published');

      return {
        success: true,
        orderId,
        status: 'completed',
        timestamp: Date.now(),
      };
    });
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
