/**
 * @fileoverview Controller demonstrating session management endpoints.
 *
 * The login flow mimics passport's req.logIn: session regeneration (fixation
 * defense) + `session.passport.user` + explicit save — so the plugin's default
 * userIdExtractor picks the user up with zero configuration.
 */

import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { SessionDemoService } from './session-demo.service';

declare module 'express-session' {
  interface SessionData {
    passport?: { user?: string };
  }
}

@Controller('demo/session')
export class SessionDemoController {
  constructor(private readonly sessionDemoService: SessionDemoService) {}

  /**
   * Passport-style login: regenerate + stamp + save.
   * POST /demo/session/login/user-1
   */
  @Post('login/:userId')
  login(@Param('userId') userId: string, @Req() req: Request) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          reject(regenerateError);
          return;
        }
        req.session.passport = { user: userId };
        req.session.save((saveError) => {
          if (saveError) {
            reject(saveError);
            return;
          }
          // Stamp IP + user agent so the device page has its columns.
          void this.sessionDemoService
            .recordActivity(req.sessionID, req.ip, req.get('user-agent'))
            .catch(() => undefined);
          resolve({ userId, sessionId: req.sessionID });
        });
      });
    });
  }

  /**
   * Who am I — 401-style payload when unauthenticated.
   * GET /demo/session/me
   */
  @Get('me')
  me(@Req() req: Request) {
    const userId = req.session?.passport?.user;
    if (!userId) {
      return { authenticated: false };
    }
    return { authenticated: true, userId, sessionId: req.sessionID };
  }

  /**
   * Device page: all sessions of the current user.
   * GET /demo/session/devices
   */
  @Get('devices')
  async devices(@Req() req: Request) {
    const userId = req.session?.passport?.user;
    if (!userId) {
      return { authenticated: false, devices: [] };
    }
    return {
      authenticated: true,
      devices: await this.sessionDemoService.devicePage(userId, req.sessionID),
    };
  }

  /**
   * "Log out everywhere else."
   * POST /demo/session/logout-others
   */
  @Post('logout-others')
  async logoutOthers(@Req() req: Request) {
    const userId = req.session?.passport?.user;
    if (!userId) {
      return { authenticated: false };
    }
    const revoked = await this.sessionDemoService.logoutOtherDevices(userId, req.sessionID);
    return { authenticated: true, revoked };
  }

  /**
   * Logout the current session.
   * POST /demo/session/logout
   */
  @Post('logout')
  logout(@Req() req: Request) {
    return new Promise((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ loggedOut: true });
      });
    });
  }

  /**
   * Session counters.
   * GET /demo/session/stats
   */
  @Get('stats')
  stats(@Req() req: Request) {
    return this.sessionDemoService.stats(req.session?.passport?.user);
  }
}
