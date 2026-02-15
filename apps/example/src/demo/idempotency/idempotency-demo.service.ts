/**
 * @fileoverview Service demonstrating idempotency.
 *
 * Shows:
 * - Idempotent payments
 * - Idempotent order creation
 * - Custom idempotency keys
 * - Fingerprint verification
 */

import { Injectable } from '@nestjs/common';

/** DTO for creating a payment */
interface CreatePaymentDto {
  amount: number;
  currency: string;
  customerId: string;
}

/** DTO for creating an order */
interface CreateOrderDto {
  items: Array<{ productId: string; quantity: number }>;
  customerId: string;
}

@Injectable()
export class IdempotencyDemoService {
  private readonly paymentCounter = new Map<string, number>();
  private readonly orderCounter = new Map<string, number>();

  /**
   * Create a payment (idempotent).
   *
   * Repeat requests with the same Idempotency-Key return
   * the same result without re-execution.
   *
   * @param dto - Payment data
   * @returns Payment result
   */
  async createPayment(dto: CreatePaymentDto) {
    // Simulate a real payment
    const key = `${dto.customerId}-${dto.amount}`;
    const executionCount = (this.paymentCounter.get(key) || 0) + 1;
    this.paymentCounter.set(key, executionCount);

    console.log(`[PAYMENT] Processing payment (attempt ${executionCount})`);
    await this.simulateDelay(1000);

    const transactionId = `TXN-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    return {
      success: true,
      transactionId,
      amount: dto.amount,
      currency: dto.currency,
      customerId: dto.customerId,
      executionCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Create an order (idempotent).
   *
   * @param dto - Order data
   * @returns Order creation result
   */
  async createOrder(dto: CreateOrderDto) {
    const key = dto.customerId;
    const executionCount = (this.orderCounter.get(key) || 0) + 1;
    this.orderCounter.set(key, executionCount);

    console.log(`[ORDER] Creating order (attempt ${executionCount})`);
    await this.simulateDelay(800);

    const orderId = `ORD-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    return {
      success: true,
      orderId,
      customerId: dto.customerId,
      items: dto.items,
      totalItems: dto.items.reduce((sum, item) => sum + item.quantity, 0),
      executionCount,
      timestamp: Date.now(),
    };
  }

  /**
   * Operation with a custom idempotency key.
   *
   * @param customKey - Custom key
   * @param data - Operation data
   * @returns Operation result
   */
  async customKeyOperation(customKey: string, data: any) {
    console.log(`[CUSTOM] Operation with key: ${customKey}`);
    await this.simulateDelay(500);

    return {
      success: true,
      customKey,
      data,
      operationId: `OP-${Date.now()}`,
      timestamp: Date.now(),
    };
  }

  /**
   * Simulate delay.
   *
   * @param ms - Duration in milliseconds
   */
  private async simulateDelay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
