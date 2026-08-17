/**
 * @fileoverview Service demonstrating session management.
 *
 * Shows:
 * - Device page (sessions per user with metadata)
 * - Revocation: revoke / revokeAll / revokeAllExcept
 * - Activity stamping (IP + user agent)
 * - Session counters
 */

import { Injectable, Inject } from '@nestjs/common';
import { SESSION_SERVICE, type ISessionService } from '@nestjs-redisx/session';

@Injectable()
export class SessionDemoService {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: ISessionService,
  ) {}

  /**
   * GitHub-style device page: every live session of the user with metadata.
   */
  async devicePage(userId: string, currentSessionId: string) {
    const devices = await this.sessions.getSessionsByUser(userId);
    return devices.map((device) => ({
      id: device.id,
      current: device.id === currentSessionId,
      ip: device.metadata?.ip,
      userAgent: device.metadata?.userAgent,
      signedInAt: device.metadata?.createdAt,
      lastActiveAt: device.metadata?.lastSeenAt,
    }));
  }

  /**
   * "Log out everywhere else" — revokes all sessions except the current one.
   */
  logoutOtherDevices(userId: string, currentSessionId: string) {
    return this.sessions.revokeAllExcept(userId, currentSessionId);
  }

  /**
   * Stamp request metadata (IP, user agent) onto the session.
   */
  recordActivity(sessionId: string, ip?: string, userAgent?: string) {
    return this.sessions.recordActivity(sessionId, { ip, userAgent });
  }

  /**
   * Live counters for dashboards.
   */
  async stats(userId?: string) {
    return {
      totalActiveSessions: await this.sessions.count(),
      userActiveSessions: userId ? await this.sessions.countByUser(userId) : undefined,
    };
  }
}
