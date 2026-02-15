/**
 * @fileoverview Demo module for @nestjs-redisx/core.
 */

import { Module } from '@nestjs/common';
import { CoreDemoController } from './core-demo.controller';
import { CoreDemoService } from './core-demo.service';

@Module({
  controllers: [CoreDemoController],
  providers: [CoreDemoService],
})
export class CoreDemoModule {}
