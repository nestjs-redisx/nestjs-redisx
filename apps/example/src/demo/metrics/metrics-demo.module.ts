/**
 * @fileoverview Demo module for @nestjs-redisx/metrics.
 */

import { Module } from '@nestjs/common';
import { MetricsDemoController } from './metrics-demo.controller';
import { MetricsDemoService } from './metrics-demo.service';

@Module({
  controllers: [MetricsDemoController],
  providers: [MetricsDemoService],
})
export class MetricsDemoModule {}
