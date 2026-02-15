/**
 * @fileoverview Service demonstrating distributed locks.
 *
 * Shows:
 * - Manual lock management
 * - withLock() pattern
 * - @WithLock decorator
 * - Lock auto-renewal
 * - Concurrent access protection
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  WithLock,
  LOCK_SERVICE,
  type ILockService,
} from '@nestjs-redisx/locks';

@Injectable()
export class LocksDemoService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}

  /**
   * Manual lock management.
   *
   * Explicitly acquires and releases a lock.
   *
   * @param resource - Resource name
   * @returns Operation result
   */
  async manualLock(resource: string) {
    const lock = await this.lockService.acquire(resource, { ttl: 10000 });

    try {
      console.log(`[LOCK] Lock acquired: ${resource}`);

      // Critical section
      await this.simulateWork(2000);

      return {
        success: true,
        resource,
        message: 'Work completed with manual lock',
      };
    } finally {
      await lock.release();
      console.log(`[LOCK] Lock released: ${resource}`);
    }
  }

  /**
   * Using the withLock() pattern.
   *
   * Lock is automatically released after execution.
   *
   * @param resource - Resource name
   * @returns Operation result
   */
  async withLockPattern(resource: string) {
    return this.lockService.withLock(
      resource,
      async () => {
        console.log(`[LOCK] Working inside lock: ${resource}`);
        await this.simulateWork(2000);

        return {
          success: true,
          resource,
          message: 'Work completed with withLock pattern',
        };
      },
      { ttl: 10000 },
    );
  }

  /**
   * Using the @WithLock decorator.
   *
   * Decorator automatically manages the lock.
   *
   * @param orderId - Order ID
   * @returns Order processing result
   */
  @WithLock({ key: 'order:{0}', ttl: 15000 })
  async processOrder(orderId: string) {
    console.log(`[LOCK] Processing order with decorator: ${orderId}`);
    await this.simulateWork(3000);

    return {
      success: true,
      orderId,
      status: 'processed',
      message: 'Order processed with @WithLock decorator',
    };
  }

  /**
   * Auto-renewal demo.
   *
   * Lock is automatically extended during execution.
   *
   * @param taskId - Task ID
   * @returns Execution result
   */
  async longRunningTask(taskId: string) {
    const lock = await this.lockService.acquire(taskId, {
      ttl: 5000, // Short TTL
      autoRenew: true, // Enable auto-renewal
    });

    try {
      console.log(`[LOCK] Starting long-running task: ${taskId}`);

      // Simulate long work (longer than TTL)
      for (let i = 1; i <= 3; i++) {
        console.log(`[LOCK] Step ${i}/3 of task ${taskId}`);
        await this.simulateWork(3000);
      }

      return {
        success: true,
        taskId,
        message: 'Long task completed with auto-renewal',
      };
    } finally {
      await lock.release();
      console.log(`[LOCK] Finished long-running task: ${taskId}`);
    }
  }

  /**
   * Concurrent access test.
   *
   * Only one request will acquire the lock, others will wait or fail.
   *
   * @param resource - Resource name
   * @param workerId - Worker ID
   * @returns Operation result
   */
  async concurrentAccess(resource: string, workerId: string) {
    try {
      const lock = await this.lockService.acquire(resource, {
        ttl: 5000,
        retry: { maxRetries: 2, initialDelay: 100 },
      });

      try {
        console.log(`[WORKER-${workerId}] Acquired lock: ${resource}`);
        await this.simulateWork(2000);

        return {
          success: true,
          workerId,
          resource,
          message: `Worker ${workerId} completed work`,
        };
      } finally {
        await lock.release();
        console.log(`[WORKER-${workerId}] Released lock: ${resource}`);
      }
    } catch (error) {
      console.log(`[WORKER-${workerId}] Failed to acquire lock`);
      return {
        success: false,
        workerId,
        resource,
        message: `Worker ${workerId} failed to acquire lock`,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Simulate work.
   *
   * @param ms - Duration in milliseconds
   */
  private async simulateWork(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
