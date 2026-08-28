/**
 * @fileoverview Leader election demo module.
 */

import { Module } from '@nestjs/common';
import { LeaderDemoController } from './leader-demo.controller';
import { LeaderDemoService } from './leader-demo.service';

@Module({
  controllers: [LeaderDemoController],
  providers: [LeaderDemoService],
})
export class LeaderDemoModule {}
