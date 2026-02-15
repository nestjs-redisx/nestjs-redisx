/**
 * @fileoverview Demo module for @nestjs-redisx/locks.
 */

import { Module } from '@nestjs/common';
import { LocksDemoController } from './locks-demo.controller';
import { LocksDemoService } from './locks-demo.service';

@Module({
  controllers: [LocksDemoController],
  providers: [LocksDemoService],
})
export class LocksDemoModule {}
