import { Injectable, Inject } from '@nestjs/common';
import { SESSION_SERVICE } from '@nestjs-redisx/session';
import type { ISessionService } from '@nestjs-redisx/session';

@Injectable()
export class SessionSecurityService {
  constructor(@Inject(SESSION_SERVICE) private readonly sessions: ISessionService) {}

  // The "log out everywhere else" button: keeps the clicking device signed in.
  logoutOtherDevices(userId: string, currentSessionId: string): Promise<number> {
    return this.sessions.revokeAllExcept(userId, currentSessionId);
  }

  // Password change / account compromise: terminate everything.
  async onPasswordChanged(userId: string): Promise<number> {
    return this.sessions.revokeAll(userId);
  }

  // Support/admin: terminate one specific session by ID.
  async revokeSingle(sessionId: string): Promise<boolean> {
    return this.sessions.revoke(sessionId);
  }

  // Live counters for dashboards.
  async stats(userId: string): Promise<{ total: number; forUser: number }> {
    return {
      total: await this.sessions.count(),
      forUser: await this.sessions.countByUser(userId),
    };
  }
}
