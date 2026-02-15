/**
 * @fileoverview Controller demonstrating distributed locks.
 *
 * Endpoints:
 * - POST /demo/locks/manual - Manual lock management
 * - POST /demo/locks/with-lock - withLock() pattern
 * - POST /demo/locks/decorator - @WithLock decorator
 * - POST /demo/locks/auto-renew - Auto-renewal demo
 * - POST /demo/locks/concurrent - Concurrent access test
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LocksDemoService } from './locks-demo.service';

@Controller('demo/locks')
export class LocksDemoController {
  constructor(private readonly locksDemo: LocksDemoService) {}

  /**
   * Simple test endpoint.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/locks/test
   * ```
   */
  @Get('test')
  async test() {
    return {
      status: 'ok',
      plugin: 'locks',
      message: 'Locks plugin is working',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Manual lock management.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/locks/manual \
   *   -H "Content-Type: application/json" \
   *   -d '{"resource": "payment-123"}'
   * ```
   */
  @Post('manual')
  @HttpCode(HttpStatus.OK)
  async manual(@Body() body: { resource: string }) {
    return this.locksDemo.manualLock(body.resource);
  }

  /**
   * Using the withLock() pattern.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/locks/with-lock \
   *   -H "Content-Type: application/json" \
   *   -d '{"resource": "inventory-456"}'
   * ```
   */
  @Post('with-lock')
  @HttpCode(HttpStatus.OK)
  async withLock(@Body() body: { resource: string }) {
    return this.locksDemo.withLockPattern(body.resource);
  }

  /**
   * Using the @WithLock decorator.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/locks/decorator \
   *   -H "Content-Type: application/json" \
   *   -d '{"orderId": "ORD-789"}'
   * ```
   */
  @Post('decorator')
  @HttpCode(HttpStatus.OK)
  async decorator(@Body() body: { orderId: string }) {
    return this.locksDemo.processOrder(body.orderId);
  }

  /**
   * Auto-renewal demo.
   *
   * The task runs for 9 seconds, but the lock TTL is only 5 seconds.
   * Auto-renewal automatically extends the lock.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/locks/auto-renew \
   *   -H "Content-Type: application/json" \
   *   -d '{"taskId": "task-001"}'
   * ```
   */
  @Post('auto-renew')
  @HttpCode(HttpStatus.OK)
  async autoRenew(@Body() body: { taskId: string }) {
    return this.locksDemo.longRunningTask(body.taskId);
  }

  /**
   * Concurrent access test.
   *
   * Run several simultaneous requests:
   *
   * @example
   * ```bash
   * # Terminal 1
   * curl -X POST http://localhost:3000/demo/locks/concurrent \
   *   -H "Content-Type: application/json" \
   *   -d '{"resource": "shared-resource", "workerId": "worker-1"}'
   *
   * # Terminal 2 (simultaneously)
   * curl -X POST http://localhost:3000/demo/locks/concurrent \
   *   -H "Content-Type: application/json" \
   *   -d '{"resource": "shared-resource", "workerId": "worker-2"}'
   *
   * # Terminal 3 (simultaneously)
   * curl -X POST http://localhost:3000/demo/locks/concurrent \
   *   -H "Content-Type: application/json" \
   *   -d '{"resource": "shared-resource", "workerId": "worker-3"}'
   * ```
   */
  @Post('concurrent')
  @HttpCode(HttpStatus.OK)
  async concurrent(@Body() body: { resource: string; workerId: string }) {
    return this.locksDemo.concurrentAccess(body.resource, body.workerId);
  }
}
