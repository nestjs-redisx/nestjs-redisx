/**
 * @fileoverview Demo module for @nestjs-redisx/cache.
 */

import { Module } from '@nestjs/common';
import { CacheDemoController } from './cache-demo.controller';
import { CacheDemoService } from './cache-demo.service';

@Module({
  controllers: [CacheDemoController],
  providers: [CacheDemoService],
})
export class CacheDemoModule {}
