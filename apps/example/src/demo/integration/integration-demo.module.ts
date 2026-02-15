/**
 * @fileoverview Demo module for integration of all @nestjs-redisx modules.
 */

import { Module } from '@nestjs/common';
import { IntegrationDemoController } from './integration-demo.controller';
import { IntegrationDemoService } from './integration-demo.service';

@Module({
  controllers: [IntegrationDemoController],
  providers: [IntegrationDemoService],
})
export class IntegrationDemoModule {}
