/**
 * @fileoverview Demo module for @nestjs-redisx/idempotency.
 */

import { Module } from '@nestjs/common';
import { IdempotencyDemoController } from './idempotency-demo.controller';
import { IdempotencyDemoService } from './idempotency-demo.service';

@Module({
  controllers: [IdempotencyDemoController],
  providers: [IdempotencyDemoService],
})
export class IdempotencyDemoModule {}
