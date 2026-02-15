/**
 * @fileoverview Controller demonstrating @nestjs-redisx/core.
 *
 * Endpoints for testing basic Redis operations.
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CoreDemoService } from './core-demo.service';

@Controller('demo/core')
export class CoreDemoController {
  constructor(private readonly service: CoreDemoService) {}


  @Get('health')
  healthCheck() {
    return this.service.healthCheck();
  }

  @Get('ping')
  ping() {
    return this.service.ping();
  }


  @Post('set')
  @HttpCode(HttpStatus.OK)
  set(@Body() body: { key: string; value: string; ttl?: number }) {
    return this.service.set(body.key, body.value, body.ttl);
  }

  @Get('get/:key')
  get(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Delete('del/:key')
  del(@Param('key') key: string) {
    return this.service.del(key);
  }

  @Post('mset')
  @HttpCode(HttpStatus.OK)
  mset(@Body() entries: Record<string, string>) {
    return this.service.mset(entries);
  }

  @Post('mget')
  @HttpCode(HttpStatus.OK)
  mget(@Body() body: { keys: string[] }) {
    return this.service.mget(body.keys);
  }

  @Post('incr/:key')
  incr(@Param('key') key: string) {
    return this.service.incr(key);
  }

  @Post('decr/:key')
  decr(@Param('key') key: string) {
    return this.service.decr(key);
  }

  @Post('exists')
  @HttpCode(HttpStatus.OK)
  exists(@Body() body: { keys: string[] }) {
    return this.service.exists(body.keys);
  }

  @Post('append')
  @HttpCode(HttpStatus.OK)
  append(@Body() body: { key: string; value: string }) {
    return this.service.append(body.key, body.value);
  }

  @Post('setnx')
  @HttpCode(HttpStatus.OK)
  setnx(@Body() body: { key: string; value: string }) {
    return this.service.setnx(body.key, body.value);
  }

  @Post('getdel/:key')
  getdel(@Param('key') key: string) {
    return this.service.getdel(key);
  }


  @Get('advanced/multiple-clients')
  multipleClients() {
    return this.service.multipleClients();
  }

  @Get('advanced/ttl-demo/:key')
  ttlDemo(@Param('key') key: string) {
    return this.service.ttlDemo(key);
  }

  @Get('advanced/batch')
  batchOperations() {
    return this.service.batchOperations();
  }
}
