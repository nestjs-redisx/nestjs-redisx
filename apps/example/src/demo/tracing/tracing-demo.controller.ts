/**
 * @fileoverview Controller demonstrating tracing.
 */

import { Controller, Get } from '@nestjs/common';
import { TracingDemoService } from './tracing-demo.service';

@Controller('demo/tracing')
export class TracingDemoController {
  constructor(private readonly tracingDemo: TracingDemoService) {}

  @Get('simple')
  async simple() {
    return this.tracingDemo.simpleOperation();
  }

  @Get('nested')
  async nested() {
    return this.tracingDemo.nestedOperation();
  }

  @Get('error')
  async error() {
    return this.tracingDemo.errorOperation();
  }
}
