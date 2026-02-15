/**
 * @fileoverview Demo module for @nestjs-redisx/rate-limit.
 */

import { Module } from '@nestjs/common';
import { RateLimitDemoController } from './rate-limit-demo.controller';
import { RateLimitDemoService } from './rate-limit-demo.service';

@Module({
  controllers: [RateLimitDemoController],
  providers: [RateLimitDemoService],
})
export class RateLimitDemoModule {}
