/**
 * @fileoverview Demo module for @nestjs-redisx/tracing.
 */

import { Module } from '@nestjs/common';
import { TracingDemoController } from './tracing-demo.controller';
import { TracingDemoService } from './tracing-demo.service';

@Module({
  controllers: [TracingDemoController],
  providers: [TracingDemoService],
})
export class TracingDemoModule {}
