import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RateLimit } from '@nestjs-redisx/rate-limit';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { TestService } from './test.service';

@Controller()
export class TestController {
  constructor(@Inject(TestService) private readonly testService: TestService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('cache/:key')
  async getFromCache(@Param('key') key: string) {
    return this.testService.getCachedData(key);
  }

  @Post('cache/invalidate')
  async invalidateCache(@Body() body: { tags: string[] }) {
    await this.testService.invalidateTags(body.tags);
    return { invalidated: true };
  }

  @Get('lock-test')
  async lockTest() {
    return this.testService.withLock();
  }

  @Get('rate-limited')
  @RateLimit({ points: 5, duration: 60 })
  rateLimited() {
    return { allowed: true };
  }

  @Post('idempotent')
  @Idempotent()
  idempotentAction() {
    return { id: randomUUID() };
  }

  @Post('stream/publish')
  async publishToStream(@Body() body: { message: string }) {
    return this.testService.publishMessage(body.message);
  }
}
