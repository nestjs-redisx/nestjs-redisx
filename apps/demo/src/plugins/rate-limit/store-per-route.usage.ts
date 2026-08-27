import { Controller, Get, Post } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';

/**
 * Plugin default is `store: 'memory'` — bulk traffic pays zero Redis
 * round-trip. Sensitive routes override back to the exact, distributed
 * Redis store per route. The override works in either direction.
 */
@Controller()
export class ApiController {
  // Uses the plugin default store ('memory'): cheap per-instance limiting.
  @Get('feed')
  @RateLimit({ points: 100, duration: 60 })
  getFeed() {
    return { items: [] };
  }

  // Auth-sensitive route pinned to Redis: the count is exact and shared by
  // ALL instances. A distributed brute force cannot multiply the limit by
  // the node count here.
  @Post('login')
  @RateLimit({ store: 'redis', points: 5, duration: 300 })
  login() {
    return { ok: true };
  }

  // The reverse also works: with a 'redis' plugin default, a hot endpoint
  // can opt into per-instance memory counting.
  @Get('health-details')
  @RateLimit({ store: 'memory', points: 30, duration: 60 })
  healthDetails() {
    return { status: 'ok' };
  }
}
