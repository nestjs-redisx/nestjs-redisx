import { Controller, Get } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';

@Controller('api')
export class RateLimitedController {
  @Get('data')
  @RateLimit({ points: 10, duration: 60 })
  getData() {
    return { data: 'rate limited endpoint' };
  }

  @Get('search')
  @RateLimit({ points: 5, duration: 60, key: 'ip' })
  search() {
    return { results: [] };
  }
}
