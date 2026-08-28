/**
 * @fileoverview Controller demonstrating leader election.
 *
 * Endpoints:
 * - GET  /demo/leader/status    - who leads, am I the leader, cron run count
 * - POST /demo/leader/step-down - voluntarily hand leadership over
 */

import { Controller, Get, Post } from '@nestjs/common';
import { LeaderDemoService } from './leader-demo.service';

@Controller('demo/leader')
export class LeaderDemoController {
  constructor(private readonly leaderDemo: LeaderDemoService) {}

  /**
   * Leadership status of this instance.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/leader/status
   * ```
   */
  @Get('status')
  async status() {
    return this.leaderDemo.status();
  }

  /**
   * Voluntarily hand leadership to another instance (planned maintenance).
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/leader/step-down
   * ```
   */
  @Post('step-down')
  async stepDown() {
    return this.leaderDemo.stepDown();
  }
}
