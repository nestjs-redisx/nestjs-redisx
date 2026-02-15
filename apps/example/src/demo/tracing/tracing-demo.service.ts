/**
 * @fileoverview Service demonstrating tracing.
 */

import { Injectable, Inject } from '@nestjs/common';
import { TRACING_SERVICE, type ITracingService } from '@nestjs-redisx/tracing';

@Injectable()
export class TracingDemoService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
  ) {}

  /**
   * Simple span.
   */
  async simpleOperation() {
    return this.tracing.withSpan('simple-operation', async () => {
      this.tracing.setAttribute('operation', 'simple');
      await this.delay(100);
      return { success: true, operation: 'simple' };
    });
  }

  /**
   * Nested spans.
   */
  async nestedOperation() {
    return this.tracing.withSpan('parent-operation', async () => {
      this.tracing.setAttribute('level', 'parent');

      await this.delay(50);

      const result1 = await this.tracing.withSpan(
        'child-operation-1',
        async () => {
          this.tracing.setAttribute('level', 'child-1');
          await this.delay(100);
          return { step: 1 };
        },
      );

      const result2 = await this.tracing.withSpan(
        'child-operation-2',
        async () => {
          this.tracing.setAttribute('level', 'child-2');
          await this.delay(100);
          return { step: 2 };
        },
      );

      return { success: true, results: [result1, result2] };
    });
  }

  /**
   * Error handling.
   */
  async errorOperation() {
    try {
      return await this.tracing.withSpan('error-operation', async () => {
        this.tracing.setAttribute('willFail', true);
        await this.delay(50);
        throw new Error('Simulated error');
      });
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
