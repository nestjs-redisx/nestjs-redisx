import { Controller, Get, Inject, Req } from '@nestjs/common';
import { SESSION_SERVICE } from '@nestjs-redisx/session';
import type { ISessionService } from '@nestjs-redisx/session';

import { AppSession } from './types';

interface SessionRequest {
  sessionID: string;
  session: { passport?: { user?: string } };
}

@Controller('account')
export class DevicePageController {
  constructor(@Inject(SESSION_SERVICE) private readonly sessions: ISessionService<AppSession>) {}

  // GitHub-style "Sessions" page: every device with IP, browser, and activity.
  @Get('sessions')
  async devicePage(@Req() req: SessionRequest) {
    const userId = req.session.passport?.user;
    const devices = await this.sessions.getSessionsByUser(userId!);

    return devices.map((device) => ({
      id: device.id,
      current: device.id === req.sessionID,
      ip: device.metadata?.ip,
      userAgent: device.metadata?.userAgent,
      signedInAt: device.metadata?.createdAt,
      lastActiveAt: device.metadata?.lastSeenAt,
    }));
  }
}
